const fs = require('fs');
const parser = require('@babel/parser');

try {
  const code = fs.readFileSync('./ui/src/pages/Configure.jsx', 'utf8');
  parser.parse(code, {
    sourceType: 'module',
    plugins: ['jsx']
  });
  console.log('PARSED_SUCCESSFULLY');
} catch (err) {
  console.error('PARSER_ERROR:', err.message);
  if (err.loc) {
    console.error(`At Line: ${err.loc.line}, Column: ${err.loc.column}`);
  }
}
