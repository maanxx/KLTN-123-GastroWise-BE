const fs = require('fs');

const configPath = 'd:/GastroWise/KLTN-123-GastroWise-AI/app/config.py';
let content = fs.readFileSync(configPath, 'utf8');

// Normalize line endings for reliable replacement
content = content.replace(/\r\n/g, '\n');

const searchBlock = `MONGO_URI = os.getenv(
    "MONGODB_URI",
    "mongodb+srv://thienthien:GastroWise2026@cluster01.adts0oq.mongodb.net/gastrowise?appName=Cluster01"
)
DB_NAME = "gastrowise"
COLLECTION_NAME = "restaurants"`;

const replaceBlock = `# [TASK-SEC-01] Remediated: Never hardcode database credentials.
# Require MONGODB_URI via environment variables (.env)
MONGO_URI = os.getenv("MONGODB_URI")
DB_NAME = os.getenv("MONGODB_DB_NAME", "gastrowise")
COLLECTION_NAME = os.getenv("MONGODB_COLLECTION_NAME", "restaurants")`;

if (!content.includes(searchBlock)) {
  console.error("searchBlock not found in config.py");
  process.exit(1);
}

content = content.replace(searchBlock, replaceBlock);
fs.writeFileSync(configPath, content, 'utf8');
console.log("Successfully remediated config.py");
