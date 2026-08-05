const xlsx = require('xlsx');
const fs = require('fs');
const path = require('path');

const inputPath = path.join(__dirname, 'studentData.xlsx');
const outputPath = path.join(__dirname, 'studentData.json');

const workbook = xlsx.readFile(inputPath);
const sheet_name_list = workbook.SheetNames;
const xlData = xlsx.utils.sheet_to_json(workbook.Sheets[sheet_name_list[0]]);

fs.writeFileSync(outputPath, JSON.stringify(xlData, null, 2));
console.log('Conversion complete');

