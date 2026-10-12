// Designed file-type thumbnails for inline file cards (D-066 follow-up). Source of truth:
// generated offline from a small script; copied here as SVG.
import type { FileThumb } from '../../shared/fileCards'
import markdown from './assets/file-thumbs/markdown.svg'
import text from './assets/file-thumbs/text.svg'
import doc from './assets/file-thumbs/doc.svg'
import pdf from './assets/file-thumbs/pdf.svg'
import excel from './assets/file-thumbs/excel.svg'
import data from './assets/file-thumbs/data.svg'
import slide from './assets/file-thumbs/slide.svg'
import image from './assets/file-thumbs/image.svg'
import video from './assets/file-thumbs/video.svg'
import html from './assets/file-thumbs/html.svg'

export const FILE_THUMBS: Record<FileThumb, string> = { markdown, text, doc, pdf, excel, data, slide, image, video, html }
