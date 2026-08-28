#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('../storage');
const { inventoryData } = require('../persistence/inventory');

const output = path.resolve(process.argv[2] || path.join(process.cwd(), 'data-inventory.json'));
const inventory = inventoryData(DATA_DIR);
fs.writeFileSync(output, JSON.stringify(inventory, null, 2));
console.log(`Inventoried ${inventory.totals.files} files (${inventory.totals.bytes} bytes) into ${output}`);
