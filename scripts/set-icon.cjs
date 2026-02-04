const { rcedit } = require('rcedit');
const path = require('path');
const fs = require('fs');

const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf-8'));
const productName = (pkg.build && pkg.build.productName) || pkg.productName || '天津美术学院AIGC Tools';
const exePath = path.join(__dirname, '../release/win-unpacked', `${productName}.exe`);
const iconPath = path.join(__dirname, '../resources/icon.ico');

console.log('正在设置图标...');
console.log('EXE:', exePath);
console.log('ICO:', iconPath);

rcedit(exePath, { icon: iconPath })
  .then(() => {
    console.log('✅ 图标设置成功！');
  })
  .catch(err => {
    console.error('❌ 图标设置失败:', err);
  });
