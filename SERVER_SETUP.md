# WhatsApp MCP Server - Server Deployment Guide

## Directory Structure

~/mcp-servers/
└── whatsapp-server/
    ├── dist/
    ├── src/
    ├── auth_info/          # WhatsApp auth (auto-created)
    ├── start.sh            # Start script
    └── .env.production     # Environment config

## Usage

1. Configure environment:
   Edit .env.production with your settings

2. Start MCP Server:
   ./start.sh

3. First run will show QR code for WhatsApp login

## Backup

Original whatsapp-crm backed up to:
~/whatsapp-crm-backup-20260218
