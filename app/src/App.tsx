import { useEffect, useMemo, useState, useRef, useCallback } from "react";
import * as echarts from "echarts";
import "./App.css";
import { companies as chartData } from "./assets/companies";

interface Message {
  sender: string;
  text: string;
  timestamp: number;
}

const api = "http://localhost:8080";

function App() {
  const chartRef = useRef<HTMLDivElement>(null);
  const chartInstance = useRef<echarts.ECharts>(null);
  const [status, setStatus] = useState<string | null>(null);
  const ws = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<NodeJS.Timeout | null>(null);
  const [tableData, setTableData] = useState<any>(null);

  const [currentChartOption, setCurrentChartOption] = useState<any>({
    title: {
      text: "SaaS companies",
    },
    tooltip: {
      trigger: "axis",
    },
    xAxis: {
      type: "category",
      data: chartData.slice(0, 20).map((c) => c.companyName),
    },
    yAxis: {
      type: "value",
    },
    series: [
      {
        name: "ARR",
        type: "line",
        data: chartData.slice(0, 20).map((c) => convertStringToInteger(c.ARR)),
        smooth: true,
        symbol: "circle",
        symbolSize: 12,
        lineStyle: {
          width: 4,
          color: "#fff",
        },
      },
    ],
  });

  useEffect(() => {
    if (chartRef.current && !chartInstance.current) {
      chartInstance.current = echarts.init(chartRef.current);
      chartInstance.current.setOption(
        processChartOption(currentChartOption, chartData),
      );

      if (tableData) {
        chartInstance.current?.dispose();
      }
    }
  }, [tableData, currentChartOption]);

  const updateChart = useCallback((newOption: any) => {
    if (newOption.type === "table") {
      setTableData(newOption);
      chartInstance.current?.dispose();
    } else {
      setTableData(null);
      chartInstance.current = echarts.init(chartRef.current);
      if (chartInstance.current) {
        const processedOption = processChartOption(newOption, chartData);
        chartInstance.current.setOption(processedOption);
      }
    }
    setCurrentChartOption(newOption);
  }, []);

  const sendMessage = (message: Message) => {
    if (ws.current && ws.current.readyState === WebSocket.OPEN) {
      ws.current.send(
        JSON.stringify({
          text: message.text,
          sender: message.sender,
          timestamp: message.timestamp,
          chartOption: currentChartOption,
        }),
      );
    } else {
      setStatus("Connection is down");
    }
  };

  const connectWebSocket = useCallback(() => {
    if (reconnectTimer.current) {
      clearTimeout(reconnectTimer.current);
    }

    const wsUrl = api.replace(/^http/, "ws") + "/ws";
    ws.current = new WebSocket(wsUrl);

    ws.current.onopen = () => {
      setStatus(null);
    };

    ws.current.onmessage = (event) => {
      const messageData = JSON.parse(event.data);

      if (messageData.type === "status") {
        setStatus(messageData.status);
      } else if (messageData.type === "message") {
        const message: Message = {
          sender: messageData.sender,
          text: messageData.text,
          timestamp: messageData.timestamp || Date.now(),
          data: messageData.data || [],
        };

        setMessages((prev) => {
          const messageExists = prev.some(
            (m) =>
              m.text === message.text &&
              m.sender === message.sender &&
              Math.abs((m.timestamp || 0) - (message.timestamp || 0)) < 1000,
          );

          return messageExists ? prev : [...prev, message];
        });

        if (messageData.sender === "bot") {
          try {
            const jsonMatch = messageData.text.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
              const chartOption = JSON.parse(jsonMatch[0]);
              updateChart(chartOption);
            }
          } catch (error) {
            console.error(error, "No valid chart option found in bot response");
          }
        }
      }
    };

    ws.current.onclose = (_) => {
      setStatus("Reconnecting...");
      reconnectTimer.current = setTimeout(() => {
        connectWebSocket();
      }, 3000);
    };

    ws.current.onerror = (_) => setStatus("Error, reconnecting...");
  }, [updateChart]);

  useEffect(() => {
    connectWebSocket();

    return () => {
      if (reconnectTimer.current) {
        clearTimeout(reconnectTimer.current);
      }
      if (ws.current) {
        ws.current.close();
      }
    };
  }, [connectWebSocket]);

  const [messages, setMessages] = useState<Message[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const formatColumnHeader = (col: string) => {
    return col
      .replace(/__/g, "")
      .replace(/([A-Z])/g, " $1")
      .trim();
  };

  const renderTable = () => {
    if (!tableData) return null;

    const processedColumns = tableData.columns.map((col: string) =>
      processFieldData(col, chartData),
    );

    return (
      <div className="dataTable">
        <h2> {tableData.title || "Table"} </h2>
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
          }}
        >
          <thead>
            <tr style={{ backgroundColor: "#f5f5f5" }}>
              {tableData.columns.map((col: string, index: number) => (
                <th
                  key={index}
                  style={{
                    border: "1px solid #ddd",
                    padding: "12px",
                    textAlign: "left",
                  }}
                >
                  {formatColumnHeader(col)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {chartData.map((_, rowIndex) => (
              <tr
                key={rowIndex}
                style={{
                  backgroundColor: rowIndex % 2 === 0 ? "#f9f9f9" : "white",
                }}
              >
                {processedColumns.map((colData: any, colIndex: number) => (
                  <td
                    key={colIndex}
                    style={{
                      border: "1px solid #ddd",
                      padding: "12px",
                    }}
                  >
                    {colData[rowIndex] || "-"}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <>
      <main style={{ width: "100vw", height: "100%" }} key={tableData}>
        {tableData && renderTable()}
        <div
          ref={chartRef}
          style={{
            width: "100vw",
            height: "100vh",
            display: tableData ? "none" : "block",
          }}
        ></div>
        <div className="chat">
          <h3>✨AI</h3>
          <div
            className="chatMessages"
            style={{ maxHeight: "80vh", overflowY: "auto" }}
          >
            {messages.map((msg, index) => {
              return (
                <div key={index} className={"message " + msg.sender}>
                  {msg.text}
                </div>
              );
            })}
            <div ref={messagesEndRef} />
          </div>
          <div className="chatControls">
            {status && <div className="status">{status}</div>}
            <div className="sendControls">
              <input
                type="text"
                ref={inputRef}
                className="messageInput"
                placeholder="Send message"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    const input = inputRef.current;
                    if (input) {
                      const text = input.value.trim();
                      const message: Message = {
                        sender: "me",
                        text,
                        timestamp: Date.now(),
                      };
                      if (text) {
                        sendMessage(message);
                        input.value = "";
                      }
                    }
                  }
                }}
              />
              <button
                className="sendMessage"
                onClick={() => {
                  const input = inputRef.current;
                  if (input) {
                    const text = input.value.trim();
                    const message: Message = {
                      sender: "me",
                      text,
                      timestamp: Date.now(),
                    };
                    if (text) {
                      sendMessage(message);
                      input.value = "";
                    }
                  }
                }}
              >
                Send
              </button>
            </div>
          </div>
        </div>
      </main>
    </>
  );
}

function processFieldData(fieldName: string, companies: any[]) {
  switch (fieldName) {
    case "__companyName__":
      return companies.map((c) => c.companyName);
    case "__ARR__":
      return companies.map((c) => convertStringToInteger(c.ARR));
    case "__Employees__":
      return companies.map((c) => {
        const emp = c.Employees;
        if (typeof emp === "string") {
          return parseInt(emp.replace(/,/g, ""));
        }
        return emp;
      });
    case "__foundedYear__":
      return companies.map((c) => c.foundedYear);
    case "__g2Rating__":
      return companies.map((c) => c.g2Rating);
    case "__Valuation__":
      return companies.map((c) => convertStringToInteger(c.Valuation));
    case "__totalFunding__":
      return companies.map((c) => convertStringToInteger(c.totalFunding));
    case "__Industry__":
      return companies.map((c) => c.Industry);
    case "__HQ__":
      return companies.map((c) => c.HQ);
    case "__topInvestors__":
      return companies.map((c) => c.topInvestors);
    default:
      return [];
  }
}

function aggregateIndustryData(companies: any[]) {
  const industryCount: { [key: string]: number } = {};
  companies.forEach((company) => {
    const industry = company.Industry;
    industryCount[industry] = (industryCount[industry] || 0) + 1;
  });

  return Object.entries(industryCount).map(([name, value]) => ({
    name,
    value,
  }));
}

function getAxisMinMax(fieldName: string): { min?: number; max?: number } {
  switch (fieldName) {
    case "__foundedYear__":
      return { min: 1970, max: 2030 };
    case "__g2Rating__":
      return { min: 0, max: 5 };
    case "__ARR__":
    case "__Employees__":
    case "__Valuation__":
    case "__totalFunding__":
    default:
      return {};
  }
}

function processChartOption(option: any, chartData: any[]): any {
  if (!option) return option;

  const processedOption = JSON.parse(JSON.stringify(option)); // Deep clone

  if (
    processedOption.xAxis &&
    processedOption.xAxis.data &&
    typeof processedOption.xAxis.data === "string" &&
    processedOption.xAxis.data.startsWith("__")
  ) {
    const fieldName = processedOption.xAxis.data;
    processedOption.xAxis.data = processFieldData(fieldName, chartData);

    const minMax = getAxisMinMax(fieldName);
    if (minMax.min !== undefined) processedOption.xAxis.min = minMax.min;
    if (minMax.max !== undefined) processedOption.xAxis.max = minMax.max;
  }

  if (processedOption.yAxis && processedOption.series) {
    let yAxisField = null;
    if (Array.isArray(processedOption.series) && processedOption.series[0]) {
      const firstSeries = processedOption.series[0];
      if (
        typeof firstSeries.data === "string" &&
        firstSeries.data.startsWith("__")
      ) {
        yAxisField = firstSeries.data;
      }
    }

    if (yAxisField) {
      const minMax = getAxisMinMax(yAxisField);
      if (minMax.min !== undefined) processedOption.yAxis.min = minMax.min;
      if (minMax.max !== undefined) processedOption.yAxis.max = minMax.max;
    }
  }

  if (processedOption.series && Array.isArray(processedOption.series)) {
    processedOption.series.forEach((series: any) => {
      if (
        series.type === "pie" &&
        typeof series.data === "string" &&
        series.data.startsWith("__")
      ) {
        if (series.data === "__Industry__") {
          series.data = aggregateIndustryData(chartData);
        }
      }
      // Regular series data
      else if (
        typeof series.data === "string" &&
        series.data.startsWith("__")
      ) {
        series.data = processFieldData(series.data, chartData);
      }
      // Array of field names
      else if (
        Array.isArray(series.data) &&
        series.data.length >= 2 &&
        typeof series.data[0] === "string" &&
        series.data[0].startsWith("__")
      ) {
        const [xField, yField] = series.data;
        const xData = processFieldData(xField, chartData);
        const yData = processFieldData(yField, chartData);
        series.data = xData.map((x: any, i: number) => [x, yData[i]]);
      }
    });
  }

  return processedOption;
}

const convertStringToInteger = (str: string) => {
  if (str === "N/A") return null;
  const match = str.match(/^\$([\d.]+)([BMKT]?)$/);
  if (!match) {
    console.log("Error processing", str);
    return null;
  }

  const [, numberPart, suffix] = match;

  let multiplier = 1;

  switch (suffix) {
    case "T":
      multiplier = 1000000000000;
      break;
    case "B":
      multiplier = 1000000000;
      break;
    case "M":
      multiplier = 1000000;
      break;
    case "K":
      multiplier = 1000;
      break;
  }

  const numericValue = parseFloat(numberPart);
  return Math.round(numericValue * multiplier);
};

export default App;
