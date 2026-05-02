// api/ai-proxy.js

const axios = require('axios');

// Configuration
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const REQUESTS_LIMIT = 100;
const TIME_WINDOW = 3600000; // 1 hour
let requestCount = 0;
let firstRequestTimestamp = null;

// Middleware to enforce usage limits
const usageLimiter = (req, res, next) => {
    const currentTime = Date.now();
    if (!firstRequestTimestamp) {
        firstRequestTimestamp = currentTime;
    }
    if (currentTime - firstRequestTimestamp < TIME_WINDOW) {
        if (requestCount >= REQUESTS_LIMIT) {
            return res.status(429).json({ message: 'Usage limit reached. Please try again later.' });
        }
    } else {
        requestCount = 0;
        firstRequestTimestamp = currentTime;
    }
    requestCount++;
    next();
};

// Function to call Anthropic API
const callAnthropicAPI = async (payload) => {
    try {
        const response = await axios.post('https://api.anthropic.com/v1/ai', payload, {
            headers: { 'Authorization': `Bearer ${ANTHROPIC_API_KEY}` }
        });
        return response.data;
    } catch (error) {
        console.error('Error calling Anthropic API:', error);
        throw error;
    }
};

module.exports = { usageLimiter, callAnthropicAPI };