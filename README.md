# HostTools API v2.0.0

**OpenAI-Compatible API** for Video and Image Generation with Firebase & Supabase integration.

## 🚀 Features

- ✅ **OpenAI Compatible**: Drop-in replacement for OpenAI API
- ✅ **Video Generation**: Powered by Kling Omni (via Supabase)
- ✅ **Image Generation**: Powered by Gemini Enhanced (via Supabase)
- ✅ **Secure**: All backend details hidden from clients
- ✅ **Scalable**: Deployed on Vercel Serverless Functions
- ✅ **User Management**: Firebase Realtime Database for keys and balances
- ✅ **Credit System**: Built-in balance management

## 📋 Requirements

- Node.js 18+
- Firebase Account (for user management)
- Supabase Account (for video/image generation)
- Vercel Account (for deployment)

## 🔧 Setup

### 1. Clone & Install

```bash
git clone https://github.com/Hoswebsites/hamziweMahmodu.git
cd hamziweMahmodu
npm install
```

### 2. Environment Variables

Set these in Vercel Project Settings → Environment Variables:

```
FIREBASE_PROJECT_ID=your_project_id
FIREBASE_PRIVATE_KEY_ID=your_key_id
FIREBASE_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----
FIREBASE_CLIENT_EMAIL=your_email@iam.gserviceaccount.com
FIREBASE_CLIENT_ID=your_client_id
FIREBASE_CLIENT_X509_CERT_URL=https://www.googleapis.com/robot/v1/metadata/x509/...
FIREBASE_DB_URL=https://your-project.firebasedatabase.app
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_KEY=your_supabase_key
BASE_URL=https://your-domain.vercel.app
```

### 3. Deploy

```bash
vercel deploy --prod
```

## 📖 API Documentation

### Base URL
```
https://your-domain.vercel.app
```

### Authentication
All requests require an API key:

```bash
Authorization: Bearer sk_your_api_key_here
# or
?key=sk_your_api_key_here
```

### Endpoints

#### 1. Health Check
```bash
GET /api/health
```

Response:
```json
{
  "status": "healthy",
  "version": "2.0.0",
  "app": "HostTools API"
}
```

#### 2. List Models
```bash
GET /v1/models
```

Response:
```json
{
  "object": "list",
  "data": [
    {
      "id": "kling-v3-omni",
      "object": "model",
      "type": "video_generation"
    },
    {
      "id": "gemini-image-enhanced",
      "object": "model",
      "type": "image_generation"
    }
  ]
}
```

#### 3. Chat Completions (Auto-detect video/image)
```bash
POST /v1/chat/completions
Content-Type: application/json
Authorization: Bearer sk_your_api_key

{
  "model": "gpt-3.5-turbo",
  "messages": [
    {
      "role": "user",
      "content": "Generate a video of a cat dancing"
    }
  ]
}
```

#### 4. Video Generation
```bash
POST /v1/videos/generations
Content-Type: application/json
Authorization: Bearer sk_your_api_key

{
  "model": "kling-v3-omni",
  "messages": [
    {
      "role": "user",
      "content": "A cinematic shot of a futuristic city at night"
    }
  ]
}
```

Response:
```json
{
  "id": "chatcmpl-abc123",
  "object": "chat.completion",
  "created": 1234567890,
  "model": "kling-v3-omni",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "{\"type\": \"video_generation\", \"task_id\": \"task_xyz\", \"status\": \"processing\", \"created_at\": \"2026-07-28T...\"}"
      },
      "finish_reason": "stop"
    }
  ]
}
```

#### 5. Image Generation
```bash
POST /v1/images/generations
Content-Type: application/json
Authorization: Bearer sk_your_api_key

{
  "model": "gemini-image-enhanced",
  "messages": [
    {
      "role": "user",
      "content": "A beautiful sunset over the ocean"
    }
  ]
}
```

Response:
```json
{
  "created": 1234567890,
  "data": [
    {
      "url": "https://..."
    }
  ]
}
```

## 💰 Pricing

| Operation | Cost |
| --- | --- |
| Video Generation | 10 credits |
| Image Generation | 5 credits |

## 🔐 Security

- **Hidden Backend**: Supabase URLs and keys are never exposed to clients
- **API Key Validation**: All requests validated against Firebase
- **Balance Checking**: Credits deducted before processing
- **Error Handling**: Generic error messages to prevent information leakage

## 📝 Example Usage

### Python
```python
from openai import OpenAI

client = OpenAI(
    api_key="sk_your_api_key",
    base_url="https://your-domain.vercel.app"
)

response = client.chat.completions.create(
    model="gpt-3.5-turbo",
    messages=[{
        "role": "user",
        "content": "Generate a video of a dancing robot"
    }]
)

print(response.choices[0].message.content)
```

### JavaScript
```javascript
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: "sk_your_api_key",
  baseURL: "https://your-domain.vercel.app"
});

const response = await client.chat.completions.create({
  model: "gpt-3.5-turbo",
  messages: [{
    role: "user",
    content: "Generate an image of a sunset"
  }]
});

console.log(response.choices[0].message.content);
```

### cURL
```bash
curl -X POST https://your-domain.vercel.app/v1/chat/completions \
  -H "Authorization: Bearer sk_your_api_key" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-3.5-turbo",
    "messages": [{
      "role": "user",
      "content": "Generate a video of a cat"
    }]
  }'
```

## 🛠️ Development

### Local Development
```bash
npm run dev
```

This starts Vercel dev server at `http://localhost:3000`

### Build
```bash
npm run build
```

## 📊 Architecture

```
┌─────────────┐
│   Client    │
└──────┬──────┘
       │
       │ (API Key in header)
       ▼
┌──────────────────────────────┐
│  Vercel Serverless Function  │
│  (api/index.ts)              │
└──────┬───────────────┬────────┘
       │               │
       ▼               ▼
   Firebase        Supabase
   (Auth/Balance)  (Generation)
```

## 🚀 Deployment

### Via Vercel CLI
```bash
vercel deploy --prod
```

### Via GitHub
1. Push to main branch
2. Vercel auto-deploys

## 📞 Support

For issues or questions, open an issue on GitHub.

## 📄 License

MIT License - See LICENSE file for details

---

**Version**: 2.0.0  
**Last Updated**: July 2026  
**Maintained by**: HostTools Team
