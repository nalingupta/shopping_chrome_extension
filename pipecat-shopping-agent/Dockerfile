# Use official Pipecat base image
FROM dailyco/pipecat-base:latest-py3.11

# Set working directory
WORKDIR /app

# Copy requirements and install dependencies
COPY requirements.txt requirements.txt
RUN pip install --no-cache-dir --upgrade -r requirements.txt

# Copy the bot code
COPY bot.py bot.py

# The entry point is automatically handled by the base image
# No need to specify CMD - it looks for bot.py with bot() function