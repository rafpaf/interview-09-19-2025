import asyncio
import json
import os
from typing import List

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from models import Message
from openai import AsyncOpenAI

app = FastAPI()

messages: List[Message] = []


class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        self.active_connections.remove(websocket)

    async def send_personal_message(self, message: str, websocket: WebSocket):
        await websocket.send_text(message)

    async def broadcast(self, message: str):
        for connection in self.active_connections:
            await connection.send_text(message)


manager = ConnectionManager()

openai_client = AsyncOpenAI(api_key=os.getenv("OPENAI_API_KEY"))

COMPANIES_DATA_DESCRIPTION = """
You have access to a dataset of 100+ SaaS companies with the following fields:
- companyName: Company name (e.g. "Microsoft", "Salesforce")
- foundedYear: Year founded (e.g. 1975, 1999)
- HQ: Headquarters location (e.g. "Redmond, WA, USA")
- Industry: Industry category (e.g. "Enterprise Software", "CRM", "Creative Software", "Database & Enterprise", "Financial Software", "IT Service Management", "HR & Finance", "Video Communications", "E-commerce", etc.)
- totalFunding: Total funding raised (e.g. "$1B", "$65.4M")
- ARR: Annual Recurring Revenue (e.g. "$270B", "$37.9B")
- Valuation: Company valuation (e.g. "$3T", "$227.8B")
- Employees: Number of employees (e.g. "221,000", "75,000")
- topInvestors: Major investors (e.g. "Bill Gates, Paul Allen")
- Product: Main products (e.g. "Azure, Office 365, Teams")
- g2Rating: G2 rating out of 5 (e.g. 4.4, 4.3)

You can create different visualizations using this data including:
- Bar charts, line charts, area charts for numerical data
- Pie charts for categorical breakdowns (e.g. by Industry, HQ location)
- Scatter plots for correlations
- Any other ECharts-supported visualization types
"""


def convert_messages_to_openai_format(
    messages: List[Message], current_chart_option: dict = None, user_request: str = ""
) -> List[dict]:
    """Convert our message history to OpenAI chat format"""
    print("user_request", user_request)

    if user_request:
        # For visualization updates/creation, use specialized prompt
        system_content = (
            "You are an ECharts visualization assistant. You help users create and modify data visualizations.\n\n"
            + COMPANIES_DATA_DESCRIPTION
            + '\n\nWhen users request changes to existing charts OR ask for new charts, provide ONLY the complete JSON configuration with no additional text or explanations.\n\nFor CHARTS: Your response should be a valid JSON object that can be directly used as an ECharts option.\n\nFor TABLES: When users ask for tables or tabular data, return a JSON object with type: "table" at the top level, like this:\n{\n  "type": "table",\n  "columns": ["__companyName__", "__Industry__", "__ARR__"],\n  "title": "Company Data Table"\n}\n\nIMPORTANT: For data fields, DO NOT provide actual data values. Instead, provide field names that the frontend can use to extract data from the companies dataset. Use this format:\n- For xAxis data: use "__FIELD_NAME__" (e.g. "__companyName__", "__Industry__")\n- For series data: use "__FIELD_NAME__" for single field, or ["__FIELD_1__", "__FIELD_2__"] for multiple fields\n- For pie chart data: use "__FIELD_NAME__" for the field to aggregate by (e.g. "__Industry__")\n- For table columns: use array of "__FIELD_NAME__" values\n\nExamples:\n- Bar chart by company: xAxis data: "__companyName__", series data: "__ARR__"\n- Pie chart by industry: series data should have value: "__Industry__"\n- Scatter plot: series data: [{"name": "Companies", "data": ["__ARR__", "__Employees__"]}] (array of field names for x,y coordinates)\n- Multi-series chart: series: [{"name": "ARR", "data": "__ARR__"}, {"name": "Employees", "data": "__Employees__"}]\n\nIMPORTANT: For the foundedYear field, include a min of 1970 and a max of 2030\n\nExample axis configuration:\n"yAxis": {\n  "type": "value",\n  "name": "Founded Year",\n  "min": 1970,\n  "max": 2030\n}\n\nThe frontend will process these field names and populate with actual data from the companies dataset. '
        )

        if current_chart_option:
            chart_json = json.dumps(current_chart_option, indent=2)
            user_content = (
                "Here is an echarts option object: <option>"
                + chart_json
                + "</option>\n\nA user who wants to update it has made the following request: <request>"
                + user_request
                + "</request>\n\nFollowing this request, provide a modified JSON object. ****ONLY PROVIDE A JSON OBJECT, NOTHING ELSE.****"
            )
        else:
            user_content = (
                "A user has made the following request for a new visualization: <request>"
                + user_request
                + "</request>\n\nUsing the company dataset described in the system message, create an appropriate ECharts configuration. Provide the complete JSON object. ONLY PROVIDE A JSON OBJECT, NOTHING ELSE."
            )

        return [
            {"role": "system", "content": system_content},
            {"role": "user", "content": user_content},
        ]
    else:
        openai_messages = [
            {
                "role": "system",
                "content": "You are a helpful assistant for chart visualization. Help users modify their ECharts configurations.",
            }
        ]

        for message in messages:
            role = "assistant" if message.sender == "bot" else "user"
            openai_messages.append({"role": role, "content": message.text})

        return openai_messages


async def generate_response(
    conversation_history: List[Message],
    chart_option: dict = None,
    user_request: str = "",
) -> str:
    """Generate a response using ChatGPT with full conversation context"""
    try:
        openai_messages = convert_messages_to_openai_format(
            conversation_history, chart_option, user_request
        )

        import pprint

        print("Pinging openai...")
        pprint.pprint(openai_messages)

        response = await openai_client.chat.completions.create(
            model="gpt-5",
            messages=openai_messages,
        )
        return response.choices[0].message.content.strip()
    except Exception as e:
        print(f"Error generating response: {e}")
        return "I'm sorry, I encountered an error while processing your message."


app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)

    for message in messages:
        await manager.send_personal_message(
            json.dumps(
                {
                    "type": "message",
                    "sender": message.sender,
                    "text": message.text,
                    "timestamp": message.timestamp,
                }
            ),
            websocket,
        )

    try:
        while True:
            data = await websocket.receive_text()
            message_data = json.loads(data)

            message = Message(
                text=message_data["text"],
                sender=message_data["sender"],
                timestamp=message_data.get("timestamp"),
            )
            messages.append(message)

            await manager.broadcast(
                json.dumps(
                    {
                        "type": "message",
                        "sender": message.sender,
                        "text": message.text,
                        "timestamp": message.timestamp,
                    }
                )
            )

            if message.sender != "bot":
                await manager.broadcast(
                    json.dumps({"type": "status", "status": "Thinking..."})
                )

                chart_option = message_data.get("chartOption")
                if chart_option:
                    bot_response = await generate_response(
                        messages, chart_option, message.text
                    )
                else:
                    bot_response = await generate_response(messages)

                await manager.broadcast(json.dumps({"type": "status", "status": None}))

                bot_message = Message(
                    text=bot_response,
                    sender="bot",
                    timestamp=message.timestamp + 1,  # Slightly later timestamp
                )
                messages.append(bot_message)

                await manager.broadcast(
                    json.dumps(
                        {
                            "type": "message",
                            "sender": "bot",
                            "text": bot_response,
                            "timestamp": bot_message.timestamp,
                        }
                    )
                )

    except WebSocketDisconnect:
        manager.disconnect(websocket)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8080)
