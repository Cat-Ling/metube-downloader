#!/bin/bash

# Build script for MeTube Firefox Extension

# Exit on error
set -e

echo "Building MeTube Firefox Extension..."

# 1. Clean up
rm -rf dist
rm -f metube-extension-firefox.zip

# 2. Create dist folder
mkdir -p dist

# 3. Copy files
cp -r icons lib dist/
cp background.js content-script.js options.html options.js player.html player.js popup.html popup.js dist/

# 4. Modify manifest for Firefox
# Firefox requires browser_specific_settings for some features and usually uses gecko IDs
cp manifest.json dist/manifest.json

# Use python to inject Firefox specific settings into manifest.json
# Using a temp file for safety
python3 -c '
import json
with open("dist/manifest.json", "r") as f:
    data = json.load(f)

# Convert service_worker to scripts for Firefox MV3 compatibility in some environments
if "background" in data and "service_worker" in data["background"]:
    sw = data["background"]["service_worker"]
    data["background"]["scripts"] = [sw]
    del data["background"]["service_worker"]

# Add Firefox specific settings
if "browser_specific_settings" not in data:
    data["browser_specific_settings"] = {
        "gecko": {
            "id": "metube-downloader@clandestine.local",
            "strict_min_version": "109.0"
        }
    }

with open("dist/manifest.json", "w") as f:
    json.dump(data, f, indent=2)
'

# 5. Zip it up
cd dist
zip -r ../metube-extension-firefox.zip *
cd ..

echo "Build complete: metube-extension-firefox.zip"
