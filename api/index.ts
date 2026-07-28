import { VercelRequest, VercelResponse } from '@vercel/node';
import * as admin from 'firebase-admin';

// ============================================
// 🔐 Firebase Configuration
// ============================================

const FIREBASE_CONFIG = {
  type: "service_account",
  project_id: process.env.FIREBASE_PROJECT_ID,
  private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
  private_key: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  client_email: process.env.FIREBASE_CLIENT_EMAIL,
  client_id: process.env.FIREBASE_CLIENT_ID,
  auth_uri: "https://accounts.google.com/o/oauth2/auth",
  token_uri: "https://oauth2.googleapis.com/token",
  auth_provider_x509_cert_url: "https://www.googleapis.com/oauth2/v1/certs",
  client_x509_cert_url: process.env.FIREBASE_CLIENT_X509_CERT_URL,
  universe_domain: "googleapis.com"
};

// ============================================
// 🔒 Supabase Configuration (Hidden from clients)
// ============================================

const SUPABASE_CONFIG = {
  URL: process.env.SUPABASE_URL || "",
  KEY: process.env.SUPABASE_KEY || "",
  FUNCTIONS: {
    VIDEO_SUBMIT: `${process.env.SUPABASE_URL}/functions/v1/kling-omni-video-submit`,
    VIDEO_QUERY: `${process.env.SUPABASE_URL}/functions/v1/kling-omni-video-query`,
    IMAGE_GENERATOR: `${process.env.SUPABASE_URL}/functions/v1/gemini-image-enhanced`
  }
};

// ============================================
// ⚙️ App Configuration
// ============================================

const APP_CONFIG = {
  NAME: 'HostTools API',
  VERSION: '2.0.0',
  BASE_URL: process.env.BASE_URL || 'https://hostools.vercel.app',
};

// ============================================
// 📊 Model Names
// ============================================

const MODELS = {
  VIDEO: 'kling-v3-omni',
  IMAGE: 'gemini-image-enhanced',
  CHAT: 'gpt-3.5-turbo',
};

// ============================================
// 🔥 Firebase Admin Initialization
// ============================================

let db: admin.database.Database;

if (!admin.apps.length) {
  try {
    admin.initializeApp({
      credential: admin.credential.cert(FIREBASE_CONFIG as any),
      databaseURL: process.env.FIREBASE_DB_URL
    });
    db = admin.database();
    console.log('✅ Firebase initialized');
  } catch (error) {
    console.error('❌ Firebase init error:', error);
  }
}

// ============================================
// 📝 Type Definitions
// ============================================

interface ApiKey {
  id: string;
  name: string;
  type: 'sk_' | 'pk_';
  balance: number;
  status: 'active' | 'inactive';
  createdAt: number;
  usage: number;
}

interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  stream?: boolean;
}

// ============================================
// 🛠️ Helper Functions
// ============================================

function extractApiKey(req: VercelRequest): string | null {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.substring(7);
  }
  if (req.query.key && typeof req.query.key === 'string') {
    return req.query.key;
  }
  return null;
}

async function validateApiKey(apiKey: string): Promise<{ uid: string; key: ApiKey } | null> {
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
        if (keyData.status === 'active') {
          return { uid, key: keyData };
        }
      }
    }
    return null;
  } catch (error) {
    console.error('API key validation error:', error);
    return null;
  }
}

async function deductBalance(uid: string, keyId: string, amount: number): Promise<boolean> {
  if (!db) return false;

  try {
    const keyRef = db.ref(`users/${uid}/keys/${keyId}`);
    const snapshot = await keyRef.once('value');
    const keyData = snapshot.val();

    if (!keyData || keyData.balance < amount) {
      return false;
    }

    await keyRef.update({
      balance: keyData.balance - amount,
      usage: (keyData.usage || 0) + 1,
    });

    return true;
  } catch (error) {
    console.error('Balance deduction error:', error);
    return false;
  }
}

function generateId(prefix: string = ''): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let id = '';
  for (let i = 0; i < 16; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return prefix + id;
}

// ============================================
// 🎬 Video Generation Handler
// ============================================

async function handleVideoGeneration(req: VercelRequest, res: VercelResponse) {
  const apiKey = extractApiKey(req);
  if (!apiKey) {
    return res.status(401).json({
      error: {
        message: 'Missing API key',
        type: 'invalid_request_error',
        code: 'missing_api_key'
      }
    });
  }

  const validation = await validateApiKey(apiKey);
  if (!validation) {
    return res.status(401).json({
      error: {
        message: 'Invalid or inactive API key',
        type: 'invalid_request_error',
        code: 'invalid_api_key'
      }
    });
  }

  const body = req.body as ChatCompletionRequest;
  if (!body.messages || !Array.isArray(body.messages)) {
    return res.status(400).json({
      error: {
        message: 'messages is required and must be an array',
        type: 'invalid_request_error',
        code: 'invalid_request_error'
      }
    });
  }

  const lastUserMessage = body.messages.filter(m => m.role === 'user').pop();
  if (!lastUserMessage) {
    return res.status(400).json({
      error: {
        message: 'At least one user message is required',
        type: 'invalid_request_error',
        code: 'invalid_request_error'
      }
    });
  }

  const cost = 10;
  const deducted = await deductBalance(validation.uid, apiKey, cost);
  if (!deducted) {
    return res.status(402).json({
      error: {
        message: `Insufficient balance. Need ${cost} credits`,
        type: 'insufficient_quota',
        code: 'insufficient_balance'
      }
    });
  }

  try {
    // Call Supabase (Hidden from client)
    const videoPayload = {
      model_name: MODELS.VIDEO,
      prompt: lastUserMessage.content,
      aspect_ratio: '16:9',
      duration: '10',
      mode: 'pro',
      sound: 'on'
    };

    let taskId = 'task_' + generateId();
    try {
      const videoResponse = await fetch(SUPABASE_CONFIG.FUNCTIONS.VIDEO_SUBMIT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SUPABASE_CONFIG.KEY}`
        },
        body: JSON.stringify(videoPayload)
      });

      if (videoResponse.ok) {
        const videoData = await videoResponse.json();
        taskId = videoData?.data?.task_id || videoData?.task_id || taskId;
      }
    } catch (err) {
      console.error('Supabase call error (hidden):', err);
    }

    return res.status(200).json({
      id: 'chatcmpl-' + generateId(),
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: MODELS.VIDEO,
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: JSON.stringify({
              type: 'video_generation',
              task_id: taskId,
              status: 'processing',
              prompt: lastUserMessage.content,
              model: MODELS.VIDEO,
              created_at: new Date().toISOString()
            }, null, 2)
          },
          finish_reason: 'stop'
        }
      ],
      usage: {
        prompt_tokens: Math.ceil(lastUserMessage.content.length / 4),
        completion_tokens: 100,
        total_tokens: Math.ceil(lastUserMessage.content.length / 4) + 100
      }
    });
  } catch (error) {
    console.error('Video generation error:', error);
    return res.status(500).json({
      error: {
        message: 'Internal server error',
        type: 'server_error',
        code: 'internal_error'
      }
    });
  }
}

// ============================================
// 🖼️ Image Generation Handler
// ============================================

async function handleImageGeneration(req: VercelRequest, res: VercelResponse) {
  const apiKey = extractApiKey(req);
  if (!apiKey) {
    return res.status(401).json({
      error: {
        message: 'Missing API key',
        type: 'invalid_request_error',
        code: 'missing_api_key'
      }
    });
  }

  const validation = await validateApiKey(apiKey);
  if (!validation) {
    return res.status(401).json({
      error: {
        message: 'Invalid or inactive API key',
        type: 'invalid_request_error',
        code: 'invalid_api_key'
      }
    });
  }

  const body = req.body as ChatCompletionRequest;
  if (!body.messages || !Array.isArray(body.messages)) {
    return res.status(400).json({
      error: {
        message: 'messages is required and must be an array',
        type: 'invalid_request_error',
        code: 'invalid_request_error'
      }
    });
  }

  const lastUserMessage = body.messages.filter(m => m.role === 'user').pop();
  if (!lastUserMessage) {
    return res.status(400).json({
      error: {
        message: 'At least one user message is required',
        type: 'invalid_request_error',
        code: 'invalid_request_error'
      }
    });
  }

  const cost = 5;
  const deducted = await deductBalance(validation.uid, apiKey, cost);
  if (!deducted) {
    return res.status(402).json({
      error: {
        message: `Insufficient balance. Need ${cost} credits`,
        type: 'insufficient_quota',
        code: 'insufficient_balance'
      }
    });
  }

  try {
    // Call Supabase (Hidden from client)
    const imagePayload = {
      prompt: lastUserMessage.content,
      targetWidth: 2048,
      targetHeight: 2048,
      targetSizeMB: 6
    };

    let imageUrl = `https://media.pollinations.ai/image/${encodeURIComponent(lastUserMessage.content)}?model=flux`;
    try {
      const imageResponse = await fetch(SUPABASE_CONFIG.FUNCTIONS.IMAGE_GENERATOR, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SUPABASE_CONFIG.KEY}`
        },
        body: JSON.stringify(imagePayload)
      });

      if (imageResponse.ok) {
        const imageData = await imageResponse.json();
        if (imageData?.imageUrl) {
          imageUrl = imageData.imageUrl;
        }
      }
    } catch (err) {
      console.error('Supabase call error (hidden):', err);
    }

    return res.status(200).json({
      created: Math.floor(Date.now() / 1000),
      data: [
        {
          url: imageUrl
        }
      ]
    });
  } catch (error) {
    console.error('Image generation error:', error);
    return res.status(500).json({
      error: {
        message: 'Internal server error',
        type: 'server_error',
        code: 'internal_error'
      }
    });
  }
}

// ============================================
// 💬 Chat Completions Handler
// ============================================

async function handleChatCompletions(req: VercelRequest, res: VercelResponse) {
  const apiKey = extractApiKey(req);
  if (!apiKey) {
    return res.status(401).json({
      error: {
        message: 'Missing API key',
        type: 'invalid_request_error',
        code: 'missing_api_key'
      }
    });
  }

  const validation = await validateApiKey(apiKey);
  if (!validation) {
    return res.status(401).json({
      error: {
        message: 'Invalid or inactive API key',
        type: 'invalid_request_error',
        code: 'invalid_api_key'
      }
    });
  }

  const body = req.body as ChatCompletionRequest;
  if (!body.messages || !Array.isArray(body.messages)) {
    return res.status(400).json({
      error: {
        message: 'messages is required and must be an array',
        type: 'invalid_request_error',
        code: 'invalid_request_error'
      }
    });
  }

  const lastUserMessage = body.messages.filter(m => m.role === 'user').pop();
  if (!lastUserMessage) {
    return res.status(400).json({
      error: {
        message: 'At least one user message is required',
        type: 'invalid_request_error',
        code: 'invalid_request_error'
      }
    });
  }

  const prompt = lastUserMessage.content.toLowerCase();
  const isVideoRequest = prompt.includes('video') || prompt.includes('فيديو');
  const isImageRequest = prompt.includes('image') || prompt.includes('صورة');

  if (isVideoRequest) {
    return handleVideoGeneration(req, res);
  } else if (isImageRequest) {
    return handleImageGeneration(req, res);
  } else {
    return res.status(200).json({
      id: 'chatcmpl-' + generateId(),
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: MODELS.CHAT,
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: 'Hello! I can help you generate videos or images. Try asking for a video or image generation.'
          },
          finish_reason: 'stop'
        }
      ],
      usage: {
        prompt_tokens: Math.ceil(lastUserMessage.content.length / 4),
        completion_tokens: 50,
        total_tokens: Math.ceil(lastUserMessage.content.length / 4) + 50
      }
    });
  }
}

// ============================================
// 📊 Health Check Handler
// ============================================

async function handleHealth(req: VercelRequest, res: VercelResponse) {
  return res.status(200).json({
    status: 'healthy',
    timestamp: Date.now(),
    version: APP_CONFIG.VERSION,
    app: APP_CONFIG.NAME,
    models: {
      video: MODELS.VIDEO,
      image: MODELS.IMAGE,
      chat: MODELS.CHAT
    }
  });
}

// ============================================
// 📋 List Models Handler
// ============================================

async function handleListModels(req: VercelRequest, res: VercelResponse) {
  return res.status(200).json({
    object: 'list',
    data: [
      {
        id: MODELS.VIDEO,
        object: 'model',
        created: Math.floor(Date.now() / 1000),
        owned_by: 'hostools',
        type: 'video_generation'
      },
      {
        id: MODELS.IMAGE,
        object: 'model',
        created: Math.floor(Date.now() / 1000),
        owned_by: 'hostools',
        type: 'image_generation'
      },
      {
        id: MODELS.CHAT,
        object: 'model',
        created: Math.floor(Date.now() / 1000),
        owned_by: 'hostools',
        type: 'chat'
      }
    ]
  });
}

// ============================================
// 🔀 Main Router
// ============================================

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const path = req.url?.split('?')[0] || '';

  try {
    // Health check
    if (path === '/api/health' || path === '/health') {
      return await handleHealth(req, res);
    }

    // List models
    if (path === '/v1/models') {
      return await handleListModels(req, res);
    }

    // Chat completions
    if (path === '/v1/chat/completions') {
      if (req.method === 'POST') {
        return await handleChatCompletions(req, res);
      }
      return res.status(405).json({ error: 'Method not allowed' });
    }

    // Video generation
    if (path === '/v1/videos/generations') {
      if (req.method === 'POST') {
        return await handleVideoGeneration(req, res);
      }
      return res.status(405).json({ error: 'Method not allowed' });
    }

    // Image generation
    if (path === '/v1/images/generations') {
      if (req.method === 'POST') {
        return await handleImageGeneration(req, res);
      }
      return res.status(405).json({ error: 'Method not allowed' });
    }

    // Root endpoint
    if (path === '/' || path === '/api') {
      return res.status(200).json({
        name: APP_CONFIG.NAME,
        version: APP_CONFIG.VERSION,
        status: 'active',
        endpoints: {
          GET: ['/api/health', '/v1/models'],
          POST: ['/v1/chat/completions', '/v1/videos/generations', '/v1/images/generations']
        },
        auth: 'Bearer YOUR_API_KEY',
        compatible: 'OpenAI API'
      });
    }

    // 404
    return res.status(404).json({
      error: {
        message: 'Endpoint not found',
        type: 'invalid_request_error',
        code: 'not_found'
      }
    });
  } catch (error) {
    console.error('Unhandled error:', error);
    return res.status(500).json({
      error: {
        message: 'Internal server error',
        type: 'server_error',
        code: 'internal_error'
      }
    });
  }
}
