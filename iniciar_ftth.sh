#!/bin/bash
# iniciar_ftth.sh — Arranca el FTTH Manager
# Corre: bash ~/iniciar_ftth.sh

cd /home/jellyfin/.openclaw/workspace/ftth-project
node backend/server.js &
echo "✅ FTTH Manager iniciado en http://localhost:3010"
echo ""
echo "📌 Para que arranque automáticamente al iniciar el sistema:"
echo "   Abre una terminal y pega estos comandos:"
echo ""
echo "   sudo cp /tmp/ftth-manager.service /etc/systemd/system/ftth-manager.service"
echo "   sudo systemctl daemon-reload"
echo "   sudo systemctl enable ftth-manager"
echo "   sudo systemctl restart ftth-manager"
