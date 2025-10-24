#!/bin/bash

# FastAPI Theme Development Engine Startup Script

echo "🚀 Starting FastAPI Theme Development Engine..."

# Check if Python is installed
if ! command -v python3 &> /dev/null; then
    echo "❌ Python3 is not installed. Please install Python3 first."
    exit 1
fi

# Check if we're in the right directory
if [ ! -f "app.py" ]; then
    echo "❌ app.py not found. Please run this script from the project directory."
    exit 1
fi

# Check if virtual environment exists
if [ ! -d "venv" ]; then
    echo "📦 Creating virtual environment..."
    python3 -m venv venv
fi

# Activate virtual environment
echo "🔧 Activating virtual environment..."
source venv/bin/activate

# Install dependencies
echo "📚 Installing dependencies..."
pip install -r requirements.txt

# Start the server
echo "🌐 Starting FastAPI server..."
echo "🎨 Theme Development Engine will be available at: http://localhost:8000"
echo "📝 Edit themes in your browser with live preview!"
echo "⚡ Press Ctrl+C to stop the server"
echo ""

python app.py