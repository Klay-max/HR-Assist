// api/proxy.js

const formidable = require('formidable');
const fs = require('fs');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

export const config = {
    api: {
        bodyParser: false,
    },
};

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).send('Method Not Allowed');
    }

    try {
        const form = formidable.formidable({ maxFileSize: 10 * 1024 * 1024, keepExtensions: true });
        const [fields, files] = await form.parse(req);
        const uploadedFile = files.file[0];

        if (!uploadedFile) {
            return res.status(400).json({ errorMessage: '未找到上传的文件' });
        }

        const fileContent = fs.readFileSync(uploadedFile.filepath);
        const base64File = `data:${uploadedFile.mimetype};base64,${fileContent.toString('base64')}`;
        
        const cozeApiKey = process.env.COZE_API_KEY; 
        const cozeBotId = process.env.COZE_BOT_ID;
        
        if (!cozeApiKey || !cozeBotId) {
            return res.status(500).json({ errorMessage: '服务器未配置Coze凭证' });
        }

        const queryPayload = {
            file_info: {
                file_name: uploadedFile.originalFilename,
                file_content_base64: base64File,
                file_type: uploadedFile.mimetype,
            },
        };

        const cozeRequestBody = {
            bot_id: cozeBotId,
            user: "server_user_" + Date.now(),
            query: JSON.stringify(queryPayload),
            // 【核心改动】: 开启流式输出
            stream: true, 
        };

        const cozeResponse = await fetch("https://api.coze.cn/open_api/v2/chat", {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${cozeApiKey}`,
                'Content-Type': 'application/json',
                'Accept': 'text/event-stream', // 告诉Coze我们要接收流式数据
            },
            body: JSON.stringify(cozeRequestBody),
        });

        if (!cozeResponse.ok) {
            const errorText = await cozeResponse.text();
            throw new Error(`Coze API 返回错误: ${errorText}`);
        }
        
        // --- 处理流式响应 ---
        let finalContent = "";
        let conversationId = "";

        for await (const chunk of cozeResponse.body) {
            const lines = chunk.toString('utf8').split('\n');
            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    try {
                        const data = JSON.parse(line.substring(6));
                        if (data.message && data.message.type === 'answer') {
                            finalContent += data.message.content;
                        }
                        if (data.conversation_id) {
                            conversationId = data.conversation_id;
                        }
                    } catch (e) {
                        // 忽略无法解析的行
                    }
                }
            }
        }

        if (finalContent) {
            res.status(200).json({ finalContent: finalContent });
        } else {
            res.status(500).json({ errorMessage: `Coze API未返回有效内容。` });
        }

    } catch (error) {
        console.error("Proxy Function Error:", error);
        res.status(500).json({ errorMessage: error.message });
    }
}
