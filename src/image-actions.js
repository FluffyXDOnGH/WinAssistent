const fs = require('node:fs/promises');
const path = require('node:path');
const { nativeImage } = require('electron');
const { PDFDocument } = require('pdf-lib');

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png']);

function isSupportedImage(file) {
  return IMAGE_EXTENSIONS.has(path.extname(file).toLowerCase());
}

function orderImages(files, order) {
  if (
    !Array.isArray(order) ||
    order.length !== files.length ||
    !order.every((index) => Number.isInteger(index) && index >= 0 && index < files.length) ||
    new Set(order).size !== files.length
  ) {
    throw new Error('Ungültige Bildreihenfolge.');
  }
  return order.map((index) => files[index]);
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

async function prepareForSharing(files, options = {}) {
  await checkedImages(files);
  const { maxEdge = 1600, mode = 'clean' } = options;
  if (!['clean', 'original'].includes(mode)) throw new Error('Invalid image export mode.');
  if (mode === 'clean' && ![1200, 1600, 2048].includes(maxEdge))
    throw new Error('Invalid image size.');
  const created = [];
  for (const file of files) {
    const extension = path.extname(file).toLowerCase();
    const target = await uniquePath(
      path.dirname(file),
      `${path.parse(file).name}-${mode === 'original' ? 'original' : 'share'}`,
      extension,
    );
    if (mode === 'original') {
      await fs.copyFile(file, target, fs.constants.COPYFILE_EXCL);
      created.push(target);
      continue;
    }
    const { image, size } = decodedImage(file);
    const factor = Math.min(1, maxEdge / Math.max(size.width, size.height));
    const resized =
      factor < 1
        ? image.resize({ width: Math.max(1, Math.round(size.width * factor)), quality: 'best' })
        : image;
    const bytes = extension === '.png' ? resized.toPNG() : resized.toJPEG(82);
    created.push(await writeNewFile(target, bytes));
  }
  return created;
}

async function saveClipboardImage(folder, image, name) {
  if (!image || image.isEmpty()) throw new Error('Kein Bild in der Zwischenablage.');
  if (!(await fs.stat(folder)).isDirectory()) throw new Error('Zuerst einen Ordner öffnen.');
  const stem = String(name || '')
    .trim()
    .replace(/\.png$/i, '');
  if (
    !stem ||
    stem.length > 100 ||
    /[<>:"/\\|?*\x00-\x1f]/.test(stem) ||
    /[. ]$/.test(stem) ||
    /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(stem)
  )
    throw new Error('Gültigen Dateinamen eingeben.');
  const { width, height } = image.getSize();
  if (!width || !height || width * height > 50_000_000)
    throw new Error('Das Bild in der Zwischenablage ist zu groß.');
  const bytes = image.toPNG();
  if (bytes.length > 100 * 1024 * 1024)
    throw new Error('Das Bild in der Zwischenablage ist zu groß.');
  return writeNewFile(await uniquePath(folder, stem, '.png'), bytes);
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

module.exports = {
  isSupportedImage,
  orderImages,
  prepareForSharing,
  saveClipboardImage,
  imagesToPdf,
};
