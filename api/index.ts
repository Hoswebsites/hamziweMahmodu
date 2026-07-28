import { VercelRequest, VercelResponse } from '@vercel/node';
import * as admin from 'firebase-admin';

// ============================================
// 🔐 Configuration
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
  MODELS: {
    VIDEO: 'kling-v3-omni',
    IMAGE: 'gemini-image-enhanced',
    CHAT: 'gpt-3.5-turbo'
  }
};

// ============================================
// 🔥 Firebase Admin Initialization
// ============================================

let db: admin.database.Database | null = null;

function initFirebase() {
  if (db) return db;
  try {
    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.cert(CONFIG.FIREBASE as any),
        databaseURL: CONFIG.FIREBASE.databaseURL
      });
    }
    db = admin.database();
    return db;
  } catch (error) {
    console.error('Firebase Init Error:', error);
    return null;
  }
}

// ============================================
// 🛠️ Helper Functions
// ============================================

function generateId(prefix: string = ''): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let id = '';
  for (let i = 0; i < 16; i++) id += chars.charAt(Math.floor(Math.random() * chars.length));
  return prefix + id;
}

function extractApiKey(req: VercelRequest): string | null {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) return authHeader.substring(7);
  if (req.query.key && typeof req.query.key === 'string') return req.query.key;
  return null;
}

async function validateApiKey(apiKey: string): Promise<any | null> {
  const database = initFirebase();
  if (!apiKey || !database) return null;
  try {
    const usersRef = database.ref('users');
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
  const database = initFirebase();
  if (!database) return false;
  try {
    const keyRef = database.ref(`users/${uid}/keys/${keyId}`);
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

// ============================================
// 📊 Task Management Endpoints
// ============================================

async function handleTaskStatus(req: VercelRequest, res: VercelResponse) {
  const taskId = req.query.task_id as string;
  if (!taskId) return res.status(400).json({ error: 'task_id required' });

  try {
    const database = initFirebase();
    if (!database) return res.status(500).json({ error: 'DB error' });

    const taskRef = database.ref(`tasks/${taskId}`);
    const snapshot = await taskRef.once('value');
    const taskData = snapshot.val();

    if (!taskData) {
      return res.status(404).json({ error: 'Task not found' });
    }

    return res.status(200).json({
      task_id: taskId,
      status: taskData.status,
      progress: taskData.progress || 0,
      result_url: taskData.result_url || null,
      error: taskData.error || null,
      created_at: taskData.created_at,
      updated_at: taskData.updated_at
    });
  } catch (error) {
    return res.status(500).json({ error: 'Internal error' });
  }
}

// ============================================
// 🎬 Video Generation Handler
// ============================================

async function handleVideoGeneration(req: VercelRequest, res: VercelResponse) {
  const apiKey = extractApiKey(req);
  if (!apiKey) return res.status(401).json({ error: { message: 'Missing API key' } });

  const validation = await validateApiKey(apiKey);
  if (!validation) return res.status(401).json({ error: { message: 'Invalid API key' } });

  const body = req.body || {};
  const messages = body.messages || [];
  const prompt = messages.filter((m: any) => m.role === 'user').pop()?.content || '';

  if (!prompt) return res.status(400).json({ error: { message: 'Prompt required' } });

  const cost = 10;
  const deducted = await deductBalance(validation.uid, apiKey, cost);
  if (!deducted) return res.status(402).json({ error: { message: 'Insufficient balance' } });

  try {
    const taskId = 'task_' + generateId();
    const database = initFirebase();

    // Store task in Firebase
    if (database) {
      await database.ref(`tasks/${taskId}`).set({
        type: 'video',
        prompt: prompt,
        status: 'processing',
        progress: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        user_id: validation.uid,
        api_key: apiKey
      });
    }

    // Call Supabase (Hidden from client)
    try {
      const videoResponse = await fetch(`${CONFIG.SUPABASE.URL}/functions/v1/kling-omni-video-submit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${CONFIG.SUPABASE.KEY}`
        },
        body: JSON.stringify({
          model_name: CONFIG.MODELS.VIDEO,
          prompt: prompt,
          task_id: taskId,
          aspect_ratio: '16:9',
          duration: '10',
          mode: 'pro',
          sound: 'on'
        })
      });

      if (videoResponse.ok) {
        const videoData: any = await videoResponse.json();
        if (database && videoData?.data?.task_id) {
          await database.ref(`tasks/${taskId}`).update({
            supabase_task_id: videoData.data.task_id
          });
        }
      }
    } catch (err) {
      console.error('Supabase error:', err);
    }

    return res.status(200).json({
      id: 'chatcmpl-' + generateId(),
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: CONFIG.MODELS.VIDEO,
      task_id: taskId,
      status: 'processing',
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: `Video generation started. Task ID: ${taskId}. Check status at /v1/tasks/status?task_id=${taskId}`
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

  const body = req.body || {};
  const messages = body.messages || [];
  const prompt = messages.filter((m: any) => m.role === 'user').pop()?.content || '';

  if (!prompt) return res.status(400).json({ error: { message: 'Prompt required' } });

  const cost = 5;
  const deducted = await deductBalance(validation.uid, apiKey, cost);
  if (!deducted) return res.status(402).json({ error: { message: 'Insufficient balance' } });

  try {
    const taskId = 'task_' + generateId();
    const database = initFirebase();

    // Store task in Firebase
    if (database) {
      await database.ref(`tasks/${taskId}`).set({
        type: 'image',
        prompt: prompt,
        status: 'processing',
        progress: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        user_id: validation.uid,
        api_key: apiKey
      });
    }

    // Call Supabase (Hidden from client)
    try {
      const imageResponse = await fetch(`${CONFIG.SUPABASE.URL}/functions/v1/gemini-image-enhanced`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${CONFIG.SUPABASE.KEY}`
        },
        body: JSON.stringify({
          prompt: prompt,
          task_id: taskId,
          targetWidth: 2048,
          targetHeight: 2048
        })
      });

      if (imageResponse.ok) {
        const imageData: any = await imageResponse.json();
        if (database && imageData?.imageUrl) {
          await database.ref(`tasks/${taskId}`).update({
            result_url: imageData.imageUrl,
            status: 'completed'
          });
        }
      }
    } catch (err) {
      console.error('Supabase error:', err);
    }

    return res.status(200).json({
      created: Math.floor(Date.now() / 1000),
      task_id: taskId,
      status: 'processing',
      data: [{
        url: null,
        task_id: taskId
      }]
    });
  } catch (error) {
    return res.status(500).json({ error: { message: 'Internal server error' } });
  }
}

// ============================================
// 🔀 Main Router
// ============================================

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') return res.status(200).end();

    const path = req.url?.split('?')[0] || '';

    // Task Status
    if (path === '/v1/tasks/status') {
      return await handleTaskStatus(req, res);
    }

    // Chat Completions
    if (path === '/v1/chat/completions' && req.method === 'POST') {
      const body = req.body || {};
      const messages = body.messages || [];
      const prompt = messages.filter((m: any) => m.role === 'user').pop()?.content.toLowerCase() || '';

      if (prompt.includes('video') || prompt.includes('فيديو')) {
        return await handleVideoGeneration(req, res);
      } else if (prompt.includes('image') || prompt.includes('صورة')) {
        return await handleImageGeneration(req, res);
      }
    }

    // Models List
    if (path === '/v1/models') {
      return res.status(200).json({
        object: 'list',
        data: [
          { id: CONFIG.MODELS.VIDEO, object: 'model', type: 'video_generation', cost: 10 },
          { id: CONFIG.MODELS.IMAGE, object: 'model', type: 'image_generation', cost: 5 },
          { id: CONFIG.MODELS.CHAT, object: 'model', type: 'chat', cost: 0 }
        ]
      });
    }

    // Health Check
    if (path === '/' || path === '/api' || path === '/api/health') {
      return res.status(200).json({
        status: 'active',
        version: '2.2.0',
        endpoints: ['/v1/chat/completions', '/v1/tasks/status', '/v1/models']
      });
    }

    return res.status(404).json({ error: 'Not found' });
  } catch (error: any) {
    console.error('Error:', error);
    return res.status(500).json({ error: error.message });
  }
}
