#!/bin/bash

# Build script for WhatsApp Bot with submodule

echo "🚀 Building WhatsApp Bot with Commands Submodule..."

# Set your GitHub token here (or pass as environment variable)
GITHUB_TOKEN=${GITHUB_TOKEN:-"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"}
DOCKER_IMAGE_NAME=${DOCKER_IMAGE_NAME:-"whatsapp-bot"}
DOCKER_TAG=${DOCKER_TAG:-"latest"}

# Check if .gitmodules exists
if [ ! -f ".gitmodules" ]; then
    echo "❌ .gitmodules file not found!"
    echo "Creating .gitmodules file..."
    
    cat > .gitmodules << EOF
[submodule "commands"]
	path = commands
	url = https://github.com/idc-what-u-think/Firekid-MD-.git
EOF
fi

# Build the Docker image
echo "🔨 Building Docker image..."
docker build \
    --build-arg GITHUB_TOKEN=$GITHUB_TOKEN \
    -t $DOCKER_IMAGE_NAME:$DOCKER_TAG \
    .

# Check if build was successful
if [ $? -eq 0 ]; then
    echo "✅ Build completed successfully!"
    echo "🐳 Image: $DOCKER_IMAGE_NAME:$DOCKER_TAG"
    
    echo ""
    echo "🚀 To run the container:"
    echo "docker run -d --name whatsapp-bot $DOCKER_IMAGE_NAME:$DOCKER_TAG"
    echo ""
    echo "📝 To see logs:"
    echo "docker logs -f whatsapp-bot"
    echo ""
    echo "🔍 To access container:"
    echo "docker exec -it whatsapp-bot /bin/sh"
else
    echo "❌ Build failed!"
    exit 1
fi
