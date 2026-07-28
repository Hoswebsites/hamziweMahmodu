import { VercelRequest, VercelResponse } from '@vercel/node';
import * as admin from 'firebase-admin';
import fetch from 'node-fetch';

// ============================================
// 🔐 Hardcoded Configuration
// ============================================

const CONFIG = {
  FIREBASE: {
    project_id: "flow-afnan",
    private_key: `-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC7Xx8...
-----END PRIVATE KEY-----`.replace(/\\n/g, '\n'),
    client_email: "firebase-adminsdk-fbsvc@flow-afnan.iam.gserviceaccount.com",
    databaseURL: "https://flow-afnan-default-rtdb.asia-southeast1.firebasedatabase.app"
  },
  SUPABASE: {
    URL: "https://gitdahrfgbkkuausumlf.supabase.co",
    KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdpdGRhaHJmZ2Jra3VhdXN1bWxmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA0Njk0ODQsImV4cCI6MjA5NjA0NTQ4NH0.MeQaW6QpVxchuRrRVZL7LBd1u5IQK5d4vyRd5csosZs"
  },
  APP: {
    BASE_URL: "https://hostools.vercel.app",
    VERSION: "2.1.1"
  },
  MODELS: {
    VIDEO: 'kling-v3-omni',
    IMAGE: 'gemini-image-enhanced',
    CHAT: 'gpt-3.5-turbo'
  }
};

// ============================================
// 🔥 Firebase Admin Initialization
// ============================================

let db: admin.database.Database;

if (!admin.apps.length) {
  try {
    admin.initializeApp({
      credential: admin.credential.cert(CONFIG.FIREBASE as any),
      databaseURL: CONFIG.FIREBASE.databaseURL
    });
    db = admin.database();
  } catch (error) {
    console.error('❌ Firebase init error:', error);
  }
}
db = admin.database();

// ============================================
// 🛠️ Helper Functions
// ============================================

function extractApiKey(req: VercelRequest): string | null {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) return authHeader.substring(7);
  if (req.query.key && typeof req.query.key === 'string') return req.query.key;
  return null;
}

async function validateApiKey(apiKey: string): Promise<any | null> {
  if (!apiKey || !db) return null;
  try {
    const usersRef = db.ref('users');
    const snapshot = await usersRef.once('value');
    const users = snapshot.val();
    if (!users) return null;
    for (const uid of Object.keys(users)) {
      const userData = users[uid];
      if (userData.keys && userData.keys[apiKey]) {
        const keyData = userData.keys[apiKey];
        if (keyData.status === 'active') return { uid, key: keyData };
      }
    }
    return null;
  } catch (error) {
    return null;
  }
}

async function deductBalance(uid: string, keyId: string, amount: number): Promise<boolean> {
  if (!db) return false;
  try {
    const keyRef = db.ref(`users/${uid}/keys/${keyId}`);
    const snapshot = await keyRef.once('value');
    const keyData = snapshot.val();
    if (!keyData || keyData.balance < amount) return false;
    await keyRef.update({
      balance: keyData.balance - amount,
      usage: (keyData.usage || 0) + 1,
    });
    return true;
  } catch (error) {
    return false;
  }
}

function generateId(prefix: string = ''): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let id = '';
  for (let i = 0; i < 16; i++) id += chars.charAt(Math.floor(Math.random() * chars.length));
  return prefix + id;
}

// ============================================
// 🎬 Video Generation Handler
// ============================================

async function handleVideoGeneration(req: VercelRequest, res: VercelResponse) {
  const apiKey = extractApiKey(req);
  if (!apiKey) return res.status(401).json({ error: { message: 'Missing API key' } });

  const validation = await validateApiKey(apiKey);
  if (!validation) return res.status(401).json({ error: { message: 'Invalid API key' } });

  const body = req.body;
  const lastUserMessage = body.messages?.filter((m: any) => m.role === 'user').pop();
  if (!lastUserMessage) return res.status(400).json({ error: { message: 'Prompt required' } });

  const cost = 10;
  const deducted = await deductBalance(validation.uid, apiKey, cost);
  if (!deducted) return res.status(402).json({ error: { message: 'Insufficient balance' } });

  try {
    const videoPayload = {
      model_name: CONFIG.MODELS.VIDEO,
      prompt: lastUserMessage.content,
      aspect_ratio: '16:9',
      duration: '10',
      mode: 'pro',
      sound: 'on'
    };

    let taskId = 'task_' + generateId();
    try {
      const videoResponse = await fetch(`${CONFIG.SUPABASE.URL}/functions/v1/kling-omni-video-submit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${CONFIG.SUPABASE.KEY}`
        },
        body: JSON.stringify(videoPayload)
      });

      if (videoResponse.ok) {
        const videoData: any = await videoResponse.json();
        taskId = videoData?.data?.task_id || videoData?.task_id || taskId;
      }
    } catch (err) {
      console.error('Supabase error:', err);
    }

    return res.status(200).json({
      id: 'chatcmpl-' + generateId(),
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: CONFIG.MODELS.VIDEO,
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: JSON.stringify({ type: 'video_generation', task_id: taskId, status: 'processing', model: CONFIG.MODELS.VIDEO }, null, 2)
        },
        finish_reason: 'stop'
      }]
    });
  } catch (error) {
    return res.status(500).json({ error: { message: 'Internal server error' } });
  }
}

// ============================================
// 🖼️ Image Generation Handler
// ============================================

async function handleImageGeneration(req: VercelRequest, res: VercelResponse) {
  const apiKey = extractApiKey(req);
  if (!apiKey) return res.status(401).json({ error: { message: 'Missing API key' } });

  const validation = await validateApiKey(apiKey);
  if (!validation) return res.status(401).json({ error: { message: 'Invalid API key' } });

  const body = req.body;
  const lastUserMessage = body.messages?.filter((m: any) => m.role === 'user').pop();
  if (!lastUserMessage) return res.status(400).json({ error: { message: 'Prompt required' } });

  const cost = 5;
  const deducted = await deductBalance(validation.uid, apiKey, cost);
  if (!deducted) return res.status(402).json({ error: { message: 'Insufficient balance' } });

  try {
    const imagePayload = { prompt: lastUserMessage.content, targetWidth: 2048, targetHeight: 2048 };

    let imageUrl = `https://media.pollinations.ai/image/${encodeURIComponent(lastUserMessage.content)}?model=flux`;
    try {
      const imageResponse = await fetch(`${CONFIG.SUPABASE.URL}/functions/v1/gemini-image-enhanced`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${CONFIG.SUPABASE.KEY}`
        },
        body: JSON.stringify(imagePayload)
      });

      if (imageResponse.ok) {
        const imageData: any = await imageResponse.json();
        imageUrl = imageData?.imageUrl || imageUrl;
      }
    } catch (err) {
      console.error('Supabase error:', err);
    }

    return res.status(200).json({
      created: Math.floor(Date.now() / 1000),
      data: [{ url: imageUrl }]
    });
  } catch (error) {
    return res.status(500).json({ error: { message: 'Internal server error' } });
  }
}

// ============================================
// 🔀 Main Router
// ============================================

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const path = req.url?.split('?')[0] || '';

  try {
    if (path === '/v1/chat/completions' && req.method === 'POST') {
      const body = req.body;
      const prompt = body.messages?.filter((m: any) => m.role === 'user').pop()?.content.toLowerCase() || '';
      
      if (prompt.includes('video') || prompt.includes('فيديو')) {
        return await handleVideoGeneration(req, res);
      } else if (prompt.includes('image') || prompt.includes('صورة')) {
        return await handleImageGeneration(req, res);
      } else {
        return res.status(200).json({
          id: 'chatcmpl-' + generateId(),
          object: 'chat.completion',
          created: Math.floor(Date.now() / 1000),
          model: CONFIG.MODELS.CHAT,
          choices: [{ index: 0, message: { role: 'assistant', content: 'I can generate videos and images. Ask for a video or image!' }, finish_reason: 'stop' }]
        });
      }
    }

    if (path === '/v1/models') {
      return res.status(200).json({
        object: 'list',
        data: [
          { id: CONFIG.MODELS.VIDEO, object: 'model', type: 'video_generation' },
          { id: CONFIG.MODELS.IMAGE, object: 'model', type: 'image_generation' },
          { id: CONFIG.MODELS.CHAT, object: 'model', type: 'chat' }
        ]
      });
    }

    if (path === '/api/health') {
      return res.status(200).json({ status: 'healthy', version: CONFIG.APP.VERSION });
    }

    // Default response for root or any other path
    return res.status(200).json({
      name: "HostTools API",
      version: CONFIG.APP.VERSION,
      status: 'active',
      endpoints: {
        GET: ['/api/health', '/v1/models'],
        POST: ['/v1/chat/completions', '/v1/videos/generations', '/v1/images/generations']
      },
      auth: 'Bearer YOUR_API_KEY',
      compatible: 'OpenAI API'
    });
  } catch (error) {
    return res.status(500).json({ error: { message: 'Internal server error' } });
  }
}
