const fs = require('fs');
const path = require('path');
const jpeg = require('jpeg-js');
const { PNG } = require('pngjs');

// 从 tafa-logo.jpg 生成 resources/icon.ico
const srcPath = path.join(__dirname, '../public/icons/tafa-logo.jpg');
const dstPath = path.join(__dirname, '../resources/icon.ico');

const jpegBuffer = fs.readFileSync(srcPath);
const jpegRaw = jpeg.decode(jpegBuffer, { useTArray: false });
const { width, height } = jpegRaw;
// jpeg-js 返回 RGB，转为 RGBA（alpha=255）
const data = Buffer.alloc(width * height * 4);
for (let i = 0; i < width * height; i++) {
  data[i * 4] = jpegRaw.data[i * 3];
  data[i * 4 + 1] = jpegRaw.data[i * 3 + 1];
  data[i * 4 + 2] = jpegRaw.data[i * 3 + 2];
  data[i * 4 + 3] = 255;
}
const srcPng = { width, height, data };

console.log('源图片尺寸:', width, 'x', height);

function resizePNG(src, newWidth, newHeight) {
  const dst = new PNG({ width: newWidth, height: newHeight });
  const xRatio = src.width / newWidth;
  const yRatio = src.height / newHeight;

  for (let y = 0; y < newHeight; y++) {
    for (let x = 0; x < newWidth; x++) {
      const srcX = Math.floor(x * xRatio);
      const srcY = Math.floor(y * yRatio);
      const srcIdx = (srcY * src.width + srcX) * 4;
      const dstIdx = (y * newWidth + x) * 4;
      dst.data[dstIdx] = src.data[srcIdx];
      dst.data[dstIdx + 1] = src.data[srcIdx + 1];
      dst.data[dstIdx + 2] = src.data[srcIdx + 2];
      dst.data[dstIdx + 3] = src.data[srcIdx + 3];
    }
  }
  return dst;
}

function pngToBmpData(png) {
  const w = png.width;
  const h = png.height;
  const bmpData = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const srcIdx = (y * w + x) * 4;
      const dstIdx = ((h - 1 - y) * w + x) * 4;
      bmpData[dstIdx] = png.data[srcIdx + 2];
      bmpData[dstIdx + 1] = png.data[srcIdx + 1];
      bmpData[dstIdx + 2] = png.data[srcIdx];
      bmpData[dstIdx + 3] = png.data[srcIdx + 3];
    }
  }
  return bmpData;
}

function createICO(pngImages) {
  const numImages = pngImages.length;
  const imageData = pngImages.map((png) => {
    const bmpData = pngToBmpData(png);
    const w = png.width;
    const h = png.height;
    const header = Buffer.alloc(40);
    header.writeUInt32LE(40, 0);
    header.writeInt32LE(w, 4);
    header.writeInt32LE(h * 2, 8);
    header.writeUInt16LE(1, 12);
    header.writeUInt16LE(32, 14);
    header.writeUInt32LE(0, 16);
    header.writeUInt32LE(bmpData.length, 20);
    const maskRowBytes = Math.ceil(w / 32) * 4;
    const mask = Buffer.alloc(maskRowBytes * h, 0);
    const totalSize = header.length + bmpData.length + mask.length;
    return { width: w, height: h, header, bmpData, mask, totalSize };
  });

  const icoHeader = Buffer.alloc(6);
  icoHeader.writeUInt16LE(0, 0);
  icoHeader.writeUInt16LE(1, 2);
  icoHeader.writeUInt16LE(numImages, 4);
  let dataOffset = 6 + numImages * 16;
  const dirEntries = imageData.map((img) => {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(img.width >= 256 ? 0 : img.width, 0);
    entry.writeUInt8(img.height >= 256 ? 0 : img.height, 1);
    entry.writeUInt8(0, 2);
    entry.writeUInt8(0, 3);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(img.totalSize, 8);
    entry.writeUInt32LE(dataOffset, 12);
    dataOffset += img.totalSize;
    return entry;
  });

  const parts = [icoHeader, ...dirEntries];
  imageData.forEach((img) => {
    parts.push(img.header, img.bmpData, img.mask);
  });
  return Buffer.concat(parts);
}

const sizes = [16, 32, 48, 256];
const pngImages = sizes.map((size) => {
  console.log('生成', size, 'x', size);
  return resizePNG(srcPng, size, size);
});

const icoBuffer = createICO(pngImages);
fs.writeFileSync(dstPath, icoBuffer);
console.log('ICO 已生成:', dstPath);
console.log('文件大小:', icoBuffer.length, '字节');
