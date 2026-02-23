import { NextRequest, NextResponse } from 'next/server';
import { getSystemPrompt, DEFAULT_MODEL } from '@/constants/ai';

interface ChatMessage {
    role: 'user' | 'assistant' | 'system';
    content: string;
}

interface ChatRequest {
    message: string;
    history?: ChatMessage[];
}

// n8n Integration
const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL;
const USE_N8N = process.env.USE_N8N === 'true';

// Call n8n Webhook
async function callN8N(message: string, history: ChatMessage[]): Promise<unknown> {
    if (!N8N_WEBHOOK_URL) {
        throw new Error('N8N_WEBHOOK_URL is not configured');
    }

    console.log('[n8n] Calling webhook:', N8N_WEBHOOK_URL);
    console.log('[n8n] Model: gemini-2.0-flash | Message:', message.substring(0, 50) + '...');

    const response = await fetch(N8N_WEBHOOK_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            message,
            history,
            model: DEFAULT_MODEL,
            provider: 'gemini',
        }),
    });

    if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error');
        console.error('[n8n] Webhook error:', response.status, errorText);
        throw new Error(`n8n webhook error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    console.log('[n8n] Response received successfully');
    return data;
}

// Call Gemini API
async function callGemini(messages: ChatMessage[]) {
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
        throw new Error('GEMINI_API_KEY is not configured. Please set GEMINI_API_KEY in your environment variables.');
    }

    console.log('[Gemini] Calling with model:', DEFAULT_MODEL);

    // Convert messages to Gemini format
    const geminiMessages = messages
        .filter(m => m.role !== 'system')
        .map(m => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: m.content }]
        }));

    // Get system instruction
    const systemInstruction = messages.find(m => m.role === 'system')?.content || '';

    const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${DEFAULT_MODEL}:generateContent?key=${apiKey}`,
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                contents: geminiMessages,
                systemInstruction: {
                    parts: [{ text: systemInstruction }]
                },
                generationConfig: {
                    maxOutputTokens: 500,
                    temperature: 0.7,
                },
            }),
        }
    );

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error('[Gemini] API error:', errorData);

        const errorMessage = errorData?.error?.message || `API error: ${response.status}`;
        if (errorMessage.includes('quota') || errorMessage.includes('RESOURCE_EXHAUSTED')) {
            throw new Error('Gemini: Quota exceeded. Please try again later.');
        }

        throw new Error(`Gemini: ${errorMessage}`);
    }

    const data = await response.json();

    // Convert Gemini response to standard format
    const content = data.candidates?.[0]?.content?.parts?.[0]?.text || 'Maaf, terjadi kesalahan.';

    return {
        id: `gemini-${Date.now()}`,
        choices: [{
            message: {
                role: 'assistant',
                content: content
            },
            finish_reason: 'stop'
        }],
        model: DEFAULT_MODEL,
        usage: {
            prompt_tokens: data.usageMetadata?.promptTokenCount || 0,
            completion_tokens: data.usageMetadata?.candidatesTokenCount || 0,
            total_tokens: data.usageMetadata?.totalTokenCount || 0,
        }
    };
}

// ========================================
// Main API Handler
// ========================================

export async function POST(request: NextRequest) {
    try {
        const body: ChatRequest = await request.json();
        const { message, history = [] } = body;

        if (!message || typeof message !== 'string') {
            return NextResponse.json(
                { error: 'Message is required' },
                { status: 400 }
            );
        }

        // Mode 1: n8n as the AI Brain
        if (USE_N8N && N8N_WEBHOOK_URL) {
            console.log('[Chat API] Using n8n mode | Model:', DEFAULT_MODEL);

            try {
                const responseData = await callN8N(message, history);

                return NextResponse.json({
                    ...(responseData as object),
                    _usedModel: DEFAULT_MODEL,
                    _via: 'n8n',
                });
            } catch (n8nError) {
                console.error('[Chat API] n8n failed, falling back to direct Gemini API:', n8nError);
                // Fall through to direct API mode
            }
        }

        // Mode 2: Direct Gemini API call
        console.log('[Chat API] Using direct Gemini API | Model:', DEFAULT_MODEL);

        // Build messages array with system prompt and history
        const messages: ChatMessage[] = [
            { role: 'system', content: getSystemPrompt() },
            ...history.map((msg) => ({
                role: msg.role as 'user' | 'assistant',
                content: msg.content,
            })),
            { role: 'user', content: message },
        ];

        const responseData = await callGemini(messages);

        const response = {
            ...(responseData as object),
            _usedModel: DEFAULT_MODEL,
            _via: 'direct',
        };

        return NextResponse.json(response);
    } catch (error) {
        console.error('[Chat API] Error:', error);
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';

        return NextResponse.json(
            {
                error: 'Failed to get AI response',
                details: errorMessage,
                suggestion: 'Please check GEMINI_API_KEY configuration.'
            },
            { status: 500 }
        );
    }
}

// Health check
export async function GET() {
    return NextResponse.json({
        status: 'ok',
        message: 'CarubaAI Chat API is running',
        mode: USE_N8N ? 'n8n' : 'direct',
        n8nConfigured: !!N8N_WEBHOOK_URL,
        hasGeminiKey: !!process.env.GEMINI_API_KEY,
        model: DEFAULT_MODEL,
        provider: 'gemini',
    });
}
