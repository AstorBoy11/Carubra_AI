import { NextRequest, NextResponse } from 'next/server';
import { getSystemPrompt, DEFAULT_MODEL } from '@/constants/ai';

interface ChatMessage {
    role: 'user' | 'assistant' | 'system';
    content: string;
}

interface ChatRequest {
    message: string;
    model?: string;
    history?: ChatMessage[];
}

export async function POST(request: NextRequest) {
    try {
        const body: ChatRequest = await request.json();
        const { message, model, history = [] } = body;

        if (!message || typeof message !== 'string') {
            return NextResponse.json(
                { error: 'Message is required' },
                { status: 400 }
            );
        }

        const apiKey = process.env.OPENROUTER_API_KEY;
        if (!apiKey) {
            console.error('OPENROUTER_API_KEY is not configured');
            return NextResponse.json(
                { error: 'API key not configured' },
                { status: 500 }
            );
        }

        const selectedModel = model || DEFAULT_MODEL;

        // Build messages array with system prompt and history
        const messages: ChatMessage[] = [
            { role: 'system', content: getSystemPrompt() },
            ...history.map((msg) => ({
                role: msg.role as 'user' | 'assistant',
                content: msg.content,
            })),
            { role: 'user', content: message },
        ];

        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': process.env.NEXT_PUBLIC_SITE_URL || 'https://utero.id',
                'X-Title': 'Utero AI Avatar',
            },
            body: JSON.stringify({
                model: selectedModel,
                messages,
                max_tokens: 500,
                temperature: 0.7,
            }),
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            console.error('OpenRouter API error:', errorData);
            return NextResponse.json(
                { error: 'Failed to get response from AI', details: errorData },
                { status: response.status }
            );
        }

        const data = await response.json();
        return NextResponse.json(data);
    } catch (error) {
        console.error('Chat API error:', error);
        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
        );
    }
}

// Health check
export async function GET() {
    return NextResponse.json({
        status: 'ok',
        message: 'Utero AI Chat API is running',
        hasApiKey: !!process.env.OPENROUTER_API_KEY
    });
}
