#!/bin/bash
# Instalar dependencias del sistema para Telegram Movie Downloader
# Ejecutar en la Raspberry Pi: bash install_deps.sh

echo "Instalando dependencias del sistema..."
sudo apt update
sudo apt install -y mediainfo ffmpeg unrar

echo "Instalando dependencias de Python..."
pip install -r requirements.txt

echo "Listo. Ejecuta: python main.py serve"
