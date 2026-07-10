// Simple Legal Chat Widget with Session Storage
class LegalChatWidget {
    constructor() {
        this.isOpen = false;
        this.chatHistory = this.loadChatHistory();
        this.sitemap = {
            'home': { url: 'index.html', description: 'Main page with firm overview' },
            'about': { url: 'about.html', description: 'Learn about our attorneys and firm' },
            'contact': { url: 'contact.html', description: 'Get in touch with our office' },
            'personal injury': { url: 'personal-injury.html', description: 'Car accidents, slip and fall, medical malpractice' },
            'practice areas': { url: 'practice-areas.html', description: 'Overview of all legal services' },
            'client login': { url: 'client-login.html', description: 'Access your case information' },
            'dashboard': { url: 'client-dashboard.html', description: 'Client portal dashboard' }
        };
        this.init();
    }

    loadChatHistory() {
        const stored = sessionStorage.getItem('legalChatHistory');
        const timestamp = sessionStorage.getItem('legalChatTimestamp');
        
        if (stored && timestamp) {
            const now = Date.now();
            const chatAge = now - parseInt(timestamp);
            const twentyFourHours = 24 * 60 * 60 * 1000; // 24 hours in milliseconds
            
            if (chatAge > twentyFourHours) {
                // Clear expired chat history
                sessionStorage.removeItem('legalChatHistory');
                sessionStorage.removeItem('legalChatTimestamp');
                return [];
            }
            
            return JSON.parse(stored);
        }
        
        return [];
    }

    saveChatHistory() {
        sessionStorage.setItem('legalChatHistory', JSON.stringify(this.chatHistory));
        sessionStorage.setItem('legalChatTimestamp', Date.now().toString());
    }

    init() {
        this.createWidget();
        this.attachEvents();
        this.loadPreviousMessages();
    }

    createWidget() {
        const widget = document.createElement('div');
        widget.innerHTML = `
            <div id="legal-chat-widget" style="position: fixed; bottom: 20px; right: 20px; z-index: 9999;">
                <div id="chat-button" style="
                    width: 60px; height: 60px; border-radius: 50%; 
                    background: linear-gradient(135deg, #007bff 0%, #0056b3 100%);
                    color: white; display: flex; align-items: center; justify-content: center;
                    cursor: pointer; box-shadow: 0 4px 12px rgba(0,123,255,0.3);
                    font-size: 24px;
                ">💬</div>
                
                <div id="chat-window" style="
                    display: none; position: absolute; bottom: 70px; right: 0;
                    width: 350px; height: 400px; background: white;
                    border-radius: 10px; box-shadow: 0 8px 25px rgba(0,0,0,0.15);
                    border: 1px solid #e0e0e0;
                ">
                    <div style="background: linear-gradient(135deg, #007bff 0%, #0056b3 100%); color: white; padding: 15px; border-radius: 10px 10px 0 0; position: relative;">
                        <h6 style="margin: 0; font-weight: 600;">Johnson Legal Team Assistant</h6>
                        <small>How can I help you today?</small>
                        <button id="clear-chat" style="position: absolute; top: 10px; right: 10px; background: none; border: none; color: white; cursor: pointer; font-size: 12px;">Clear</button>
                    </div>
                    
                    <div id="chat-messages" style="height: 280px; overflow-y: auto; padding: 15px; font-size: 14px;">
                    </div>
                    
                    <div style="padding: 15px; border-top: 1px solid #e0e0e0;">
                        <div style="display: flex; gap: 8px;">
                            <input type="text" id="chat-input" placeholder="Ask me anything..." style="
                                flex: 1; padding: 8px 12px; border: 1px solid #ddd; 
                                border-radius: 20px; outline: none; font-size: 14px;
                            ">
                            <button id="send-button" style="
                                padding: 8px 15px; background: #007bff; color: white; 
                                border: none; border-radius: 20px; cursor: pointer;
                            ">Send</button>
                        </div>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(widget);
    }

    attachEvents() {
        document.getElementById('chat-button').addEventListener('click', () => this.toggleChat());
        document.getElementById('send-button').addEventListener('click', () => this.sendMessage());
        document.getElementById('clear-chat').addEventListener('click', () => this.clearChat());
        document.getElementById('chat-input').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.sendMessage();
        });
    }

    loadPreviousMessages() {
        const messages = document.getElementById('chat-messages');
        
        if (this.chatHistory.length === 0) {
            // Show welcome message only if no history
            this.addMessage(`Hi! I'm here to help you navigate our website and find the legal assistance you need. Try asking:
                <br><br>
                • "I need help with a car accident"<br>
                • "How do I contact the office?"<br>
                • "What services do you offer?"`, 'bot', false);
        } else {
            // Load previous messages
            this.chatHistory.forEach(msg => {
                this.addMessage(msg.text, msg.sender, false);
            });
        }
    }

    clearChat() {
        this.chatHistory = [];
        sessionStorage.removeItem('legalChatHistory');
        sessionStorage.removeItem('legalChatTimestamp');
        document.getElementById('chat-messages').innerHTML = '';
        this.loadPreviousMessages();
    }

    toggleChat() {
        const window = document.getElementById('chat-window');
        this.isOpen = !this.isOpen;
        window.style.display = this.isOpen ? 'block' : 'none';
    }

    sendMessage() {
        const input = document.getElementById('chat-input');
        const message = input.value.trim();
        if (!message) return;

        this.addMessage(message, 'user');
        input.value = '';
        
        setTimeout(() => this.processMessage(message), 500);
    }

    addMessage(text, sender, saveToHistory = true) {
        const messages = document.getElementById('chat-messages');
        const messageDiv = document.createElement('div');
        
        if (sender === 'user') {
            messageDiv.style.cssText = 'margin-bottom: 10px; text-align: right;';
            messageDiv.innerHTML = `<span style="background: #007bff; color: white; padding: 8px 12px; border-radius: 15px; display: inline-block; max-width: 80%;">${text}</span>`;
        } else {
            messageDiv.style.cssText = 'margin-bottom: 10px;';
            messageDiv.innerHTML = `<span style="background: #f1f3f4; padding: 8px 12px; border-radius: 15px; display: inline-block; max-width: 80%;">${text}</span>`;
        }
        
        messages.appendChild(messageDiv);
        messages.scrollTop = messages.scrollHeight;

        // Save to history
        if (saveToHistory) {
            this.chatHistory.push({ text, sender, timestamp: Date.now() });
            this.saveChatHistory();
        }
    }

    processMessage(message) {
        const lowerMessage = message.toLowerCase();
        let response = '';

        // Simple keyword matching
        if (lowerMessage.includes('car accident') || lowerMessage.includes('personal injury') || lowerMessage.includes('slip and fall')) {
            response = `For personal injury cases including car accidents, I can direct you to our <a href="personal-injury.html" style="color: #007bff;">Personal Injury page</a>. We handle auto accidents, slip and fall, and medical malpractice cases.`;
        }
        else if (lowerMessage.includes('contact') || lowerMessage.includes('phone') || lowerMessage.includes('call')) {
            response = `You can reach us at <strong>(888) 888-8888</strong> or visit our <a href="contact.html" style="color: #007bff;">Contact page</a> for more information and to send us a message.`;
        }
        else if (lowerMessage.includes('about') || lowerMessage.includes('attorney') || lowerMessage.includes('lawyer')) {
            response = `Learn more about our attorneys and firm on our <a href="about.html" style="color: #007bff;">About page</a>. We're experienced Michigan attorneys dedicated to your success.`;
        }
        else if (lowerMessage.includes('services') || lowerMessage.includes('practice') || lowerMessage.includes('help')) {
            response = `We offer several legal services. Visit our <a href="practice-areas.html" style="color: #007bff;">Practice Areas page</a> to see all our services, or I can help you find the right area for your specific need.`;
        }
        else if (lowerMessage.includes('client') || lowerMessage.includes('login') || lowerMessage.includes('portal')) {
            response = `Existing clients can access their case information through our <a href="client-login.html" style="color: #007bff;">Client Portal</a>. New clients should contact us to set up access.`;
        }
        else {
            response = `I can help you find information about our legal services. We specialize in:<br><br>
                • <a href="personal-injury.html" style="color: #007bff;">Personal Injury</a><br>
                • <a href="probate-estate-planning.html" style="color: #007bff;">Probate & Estate Planning</a><br><br>
                Or <a href="contact.html" style="color: #007bff;">contact us</a> at (888) 888-8888 for immediate assistance.`;
        }

        this.addMessage(response, 'bot');
    }
}

// Initialize chat widget when page loads
document.addEventListener('DOMContentLoaded', () => {
    new LegalChatWidget();
});
