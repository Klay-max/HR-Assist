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
        // --- 步骤 1: 从前端接收上传的文件 ---
        // 【核心修正】: 使用 formidable.formidable() 来创建实例
        const form = formidable.formidable({ 
            maxFileSize: 10 * 1024 * 1024,
            keepExtensions: true 
        });
        const [fields, files] = await form.parse(req);
        const uploadedFile = files.file[0];

        if (!uploadedFile) {
            return res.status(400).json({ errorMessage: '未找到上传的文件' });
        }

        // --- 步骤 2: 在后端将文件读取并编码为Base64 ---
        const fileContent = fs.readFileSync(uploadedFile.filepath);
        const base64File = `data:${uploadedFile.mimetype};base64,${fileContent.toString('base64')}`;
        
        // --- 步骤 3: 从Vercel的环境变量中安全地获取Coze凭证 ---
        const cozeApiKey = process.env.COZE_API_KEY; 
        const cozeBotId = process.env.COZE_BOT_ID;
        
        if (!cozeApiKey || !cozeBotId) {
            return res.status(500).json({ errorMessage: '服务器未配置Coze凭证,请在Vercel后台设置环境变量' });
        }

        // --- 步骤 4: 构建发送给Coze API的请求体 ---
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
            stream: false,
        };

        // --- 步骤 5: 调用Coze API ---
        const cozeResponse = await fetch("https://api.coze.cn/open_api/v2/chat", {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${cozeApiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(cozeRequestBody),
        });

        if (!cozeResponse.ok) {
            const errorText = await cozeResponse.text();
            throw new Error(`Coze API 返回错误: ${errorText}`);
        }

        const cozeResult = await cozeResponse.json();

        // --- 步骤 6: 将Coze的分析结果返回给前端网页 ---
        const botMessage = cozeResult.messages?.find(msg => msg.type === 'answer');
        if (botMessage && botMessage.content) {
            res.status(200).json({ finalContent: botMessage.content });
        } else {
            res.status(500).json({ errorMessage: `Coze API未返回有效内容: ${JSON.stringify(cozeResult)}` });
        }
    } catch (error) {
        console.error("Proxy Function Error:", error);
        res.status(500).json({ errorMessage: error.message });
    }
}
