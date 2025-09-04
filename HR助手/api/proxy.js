const formidable = require('formidable');
const fetch = require('node-fetch');
const fs = require('fs');

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
        const form = formidable({});
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
            return res.status(500).json({ errorMessage: '服务器未配置Coze凭证,请在Vercel后台设置环境变量' });
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
            stream: false,
        };
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
            throw new Error(`Coze API 错误: ${errorText}`);
        }
        const cozeResult = await cozeResponse.json();
        const botMessage = cozeResult.messages?.find(msg => msg.type === 'answer');
        if (botMessage && botMessage.content) {
            res.status(200).json({ finalContent: botMessage.content });
        } else {
            res.status(500).json({ errorMessage: `Coze未返回有效内容: ${JSON.stringify(cozeResult)}` });
        }
    } catch (error) {
        console.error(error);
        res.status(500).json({ errorMessage: error.message });
    }
}