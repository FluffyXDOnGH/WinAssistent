const fs = require('node:fs/promises');
const path = require('node:path');
const { nativeImage } = require('electron');
const { PDFDocument } = require('pdf-lib');

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png']);

function isSupportedImage(file) {
  return IMAGE_EXTENSIONS.has(path.extname(file).toLowerCase());
}

async function checkedImages(files) {
  if (
    !Array.isArray(files) ||
    files.length < 1 ||
    files.length > 25 ||
    !files.every(isSupportedImage)
  ) {
    throw new Error('Select 1 to 25 JPG or PNG images.');
  }
  for (const file of files) {
    const info = await fs.stat(file);
    if (!info.isFile() || info.size > 50 * 1024 * 1024) {
      throw new Error('Each image must be a file smaller than 50 MB.');
    }
  }
  return files;
}

async function uniquePath(folder, stem, extension) {
  for (let index = 1; index < 10000; index++) {
    const suffix = index === 1 ? '' : ` (${index})`;
    const target = path.join(folder, `${stem}${suffix}${extension}`);
    try {
      await fs.access(target);
    } catch (error) {
      if (error.code === 'ENOENT') return target;
      throw error;
    }
  }
  throw new Error('No free output name was found.');
}

async function writeNewFile(target, bytes) {
  await fs.writeFile(target, bytes, { flag: 'wx' });
  return target;
}

function decodedImage(file) {
  const image = nativeImage.createFromPath(file);
  const size = image.getSize();
  if (image.isEmpty() || !size.width || !size.height) {
    throw new Error('Cannot open one of the selected images.');
  }
  return { image, size };
}

async function prepareForSharing(files, maxEdge = 1600) {
  await checkedImages(files);
  if (![1200, 1600, 2048].includes(maxEdge)) throw new Error('Invalid image size.');
  const created = [];
  for (const file of files) {
    const { image, size } = decodedImage(file);
    const factor = Math.min(1, maxEdge / Math.max(size.width, size.height));
    const resized =
      factor < 1
        ? image.resize({ width: Math.max(1, Math.round(size.width * factor)), quality: 'best' })
        : image;
    const extension = path.extname(file).toLowerCase();
    const bytes = extension === '.png' ? resized.toPNG() : resized.toJPEG(82);
    const target = await uniquePath(
      path.dirname(file),
      `${path.parse(file).name}-share`,
      extension,
    );
    created.push(await writeNewFile(target, bytes));
  }
  return created;
}

async function imagesToPdf(files) {
  await checkedImages(files);
  if (files.length < 2) throw new Error('Select at least two images.');
  const document = await PDFDocument.create();
  for (const file of files) {
    const { image, size } = decodedImage(file);
    const extension = path.extname(file).toLowerCase();
    const scale = Math.min(1, 1440 / Math.max(size.width, size.height));
    const width = Math.max(1, Math.round(size.width * scale));
    const height = Math.max(1, Math.round(size.height * scale));
    const pageImage = scale < 1 ? image.resize({ width, quality: 'best' }) : image;
    const embedded =
      extension === '.png'
        ? await document.embedPng(pageImage.toPNG())
        : await document.embedJpg(pageImage.toJPEG(90));
    document.addPage([width, height]).drawImage(embedded, { x: 0, y: 0, width, height });
  }
  const folder = path.dirname(files[0]);
  const target = await uniquePath(folder, `${path.parse(files[0]).name}-combined`, '.pdf');
  return writeNewFile(target, await document.save());
}

module.exports = { isSupportedImage, prepareForSharing, imagesToPdf };
