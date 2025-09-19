# AI-powered SaaS data visualizer

- Ensure that ports 8080 and 5173 are available
- Add an OPENAI_API_KEY to your env

## API

To run the API:

```
cd api
source venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --host 127.0.0.1 --port 8080 --reload
```

# Frontend

To run the frontend:

```
cd app
npm install
npm run dev
```

Then open http://localhost:5173
