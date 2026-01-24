const fs = require("fs");

const version = process.argv[2];

if (!version) {
  console.error("Missing version argument.");
  process.exit(1);
}

const manifests = ["manifest.json", "manifest.chrome.json"];

for (const path of manifests) {
  const data = JSON.parse(fs.readFileSync(path, "utf8"));
  data.version = version;
  fs.writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
  console.log(`Updated ${path} to ${version}`);
}
