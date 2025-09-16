# B-r0: GPT-Powered D&D Discord Bot

A sophisticated Discord bot powered by OpenAI's GPT models, designed specifically for Dungeons & Dragons campaigns and gaming communities. B-r0 (pronounced "Bro") combines artificial intelligence with tabletop gaming to enhance your D&D experience through intelligent NPCs, automated game management, and seamless Roll20 integration.

## 🎯 Features

### 🤖 AI-Powered NPCs & Personas
- **Multiple Personalities**: Create and manage different AI personas for NPCs, each with unique mannerisms, sayings, and characteristics
- **Contextual Conversations**: Maintains chat history for continuous, context-aware conversations
- **Character Development**: Generated phrases and evolving personality traits

### 🎲 Gaming Features
- **Dice Rolling**: Advanced dice rolling system supporting complex RPG dice notation
- **Roll20 Integration**: Seamless integration with Roll20 for character sheets, handouts, and journal entries
- **Event Scheduling**: Automated reminders and scheduling for gaming sessions
- **Chat History Management**: Persistent conversation tracking across sessions

### 🖼️ AI Image Capabilities
- **Image Generation**: Create custom images using AI models including Midjourney integration
- **Image Analysis**: Analyze and describe images using Azure Vision services
- **Visual Storytelling**: Enhance your campaigns with AI-generated artwork

### 🌐 Web API & Management
- **REST API**: Full-featured API with Swagger documentation for external integrations
- **Webhook Support**: Real-time notifications and third-party integrations
- **Admin Dashboard**: Web interface for bot configuration and monitoring
- **Sentry Integration**: Error tracking and performance monitoring

### ⚙️ Advanced Features
- **Multi-Model Support**: Choose between different GPT models based on your needs
- **Temperature Control**: Adjust AI creativity and randomness
- **Token Management**: Configurable input/output limits for cost control
- **Sir Mode**: Special interactive features for enhanced gaming experiences

## 🚀 Quick Start

### Prerequisites
- Node.js 16+ 
- MongoDB database
- Discord application and bot token
- OpenAI API key

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/kris-hamade/project-b-r0.git
   cd project-b-r0
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure environment variables**
   ```bash
   cp .env.example .env
   # Edit .env with your configuration
   ```

4. **Start the bot**
   ```bash
   npm start
   ```

## 🔧 Configuration

Create a `.env` file with the following variables:

```env
# Required - Core Services
DISCORD_TOKEN=your_discord_bot_token
OPENAI_API_KEY=your_openai_api_key
MONGODB_URI=mongodb://localhost:27017/your_database

# Optional - Enhanced Features
AZURE_VISION_ENDPOINT=your_azure_vision_endpoint
AZURE_VISION_KEY=your_azure_vision_key
SENTRY_DSN=your_sentry_dsn
API_KEY=your_api_key_for_rest_endpoints
WEBHOOK_KEY=your_webhook_secret_key

# Optional - Server Configuration
PORT=3000
VERSION=1.0.0

# Optional - Model Configuration
ALLOWED_USER_GPT_MODELS=gpt-3.5-turbo,gpt-4
TOKEN_INPUT_LIMIT=1000
TOKEN_OUTPUT_LIMIT=1000
TOKEN_IMAGE_ANALYSIS_LIMIT=1000
```

### Discord Bot Setup

1. Create a new application at [Discord Developer Portal](https://discord.com/developers/applications)
2. Create a bot user and copy the token
3. Enable necessary intents (Message Content Intent, Server Members Intent)
4. Invite the bot to your server with appropriate permissions

## 🎮 Discord Commands

### Core Commands
- `/personas list` - View all available AI personas
- `/personas select <name>` - Switch to a different persona
- `/model list` - Show available GPT models
- `/model select <model>` - Change the AI model
- `/roll <dice>` - Roll dice (e.g., `/roll 1d20+5`)

### Image Commands
- `/image generate <description>` - Generate an image from text
- `/image describe` - Analyze and describe an uploaded image

### Utility Commands
- `/webhook list` - Show available webhooks
- `/webhook subscribe <webhook>` - Subscribe to webhook notifications
- `/webhook unsubscribe <webhook>` - Unsubscribe from notifications

## 🌐 API Documentation

The bot includes a full REST API with Swagger documentation available at:
```
http://localhost:3000/api-docs
```

### Key API Endpoints

- `GET /api/status` - Bot health check
- `GET /api/config` - Current bot configuration
- `GET /api/uptime` - Bot uptime information
- `GET /api/chathistory` - Retrieve chat history (requires API key)
- `POST /api/uploadRoll20Data/:type` - Upload Roll20 data (requires API key)
- `DELETE /api/clearChatHistory` - Clear chat history (requires API key)

## 🐳 Docker Deployment

The project includes a Dockerfile for easy deployment:

```bash
# Build the image
docker build -t b-r0-bot .

# Run the container
docker run -d --name b-r0 \
  -p 8940:8940 \
  -e DISCORD_TOKEN=your_token \
  -e OPENAI_API_KEY=your_key \
  -e MONGODB_URI=your_mongo_uri \
  b-r0-bot
```

## 📁 Project Structure

```
project-b-r0/
├── src/
│   ├── api/              # REST API endpoints and middleware
│   ├── discord/          # Discord bot logic and commands
│   ├── imaging/          # Image generation and analysis
│   ├── models/           # MongoDB data models
│   ├── openai/           # OpenAI/GPT integration
│   ├── sentry/           # Error tracking configuration
│   └── utils/            # Utility functions and helpers
├── tests/                # Test files and collections
├── Dockerfile           # Container configuration
├── server.js            # Main application entry point
└── package.json         # Dependencies and scripts
```

## 🔧 Development

### Running in Development Mode
```bash
# Install nodemon for auto-restart
npm install -g nodemon

# Start in development mode
npx nodemon server.js
```

### Testing
The project includes Postman collections for API testing:
- `Discord_GPT_Bot_Testing_DEV.postman_collection.json`
- `Discord_GPT_Bot_Testing_PROD.postman_collection.json`

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📝 License

This project is licensed under the ISC License - see the [LICENSE](LICENSE) file for details.

## 🆘 Support

For support, questions, or feature requests:
- Open an issue on GitHub
- Check the API documentation at `/api-docs`
- Review the Postman collections for API examples

## 🙏 Acknowledgments

- OpenAI for GPT models
- Discord.js community
- Roll20 for D&D integration inspiration
- The tabletop gaming community

---

*Enhance your D&D campaigns with the power of AI! 🎲✨*
