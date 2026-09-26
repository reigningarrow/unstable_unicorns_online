#!/bin/bash
set -e

echo "🦄 Setting up Unstable Unicorns Online..."

echo ""
echo "📦 Installing server dependencies..."
cd server && npm install

echo ""
echo "📦 Installing client dependencies..."
cd ../client && npm install

echo ""
echo "🔨 Building client..."
npm run build

echo ""
echo "✅ Setup complete!"
echo ""
echo "▶ To start the server:"
echo "  cd server && node index.js"
echo ""
echo "  Then open http://localhost:3001 in your browser."
echo ""
echo "🌐 To host online:"
echo "  - Set PORT environment variable (e.g. PORT=8080)"
echo "  - Open your firewall/router to that port"
echo "  - Share your public IP with friends"
echo ""
echo "🐳 Docker (optional):"
echo "  docker build -t unstable-unicorns . && docker run -p 3001:3001 unstable-unicorns"
