import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyMediaPath,
  resolveMediaPath,
  enrichMarkdownMedia,
  workspaceFileApiUrl,
  isExternalUrl,
  looksLikeRichMarkdown,
} from './richContent.js';

describe('richContent', () => {
  it('classifies images, pdf, docx, spreadsheets, archives, and links', () => {
    assert.equal(classifyMediaPath('/apps/ws/chart.png'), 'image');
    assert.equal(classifyMediaPath('report.PDF'), 'pdf');
    assert.equal(classifyMediaPath('brief.DOCX'), 'docx');
    assert.equal(classifyMediaPath('data.XLSX'), 'spreadsheet');
    assert.equal(classifyMediaPath('export.CSV'), 'spreadsheet');
    assert.equal(classifyMediaPath('bundle.ZIP'), 'archive');
    assert.equal(classifyMediaPath('slides.PPTX'), 'presentation');
    assert.equal(classifyMediaPath('https://example.com/a.jpg'), 'image');
    assert.equal(classifyMediaPath('data:image/png;base64,abc'), 'image');
  });

  it('detects external URLs', () => {
    assert.equal(isExternalUrl('https://x.com/a.png'), true);
    assert.equal(isExternalUrl('/apps/a.png'), false);
  });

  it('resolves relative paths against cwd', () => {
    assert.equal(
      resolveMediaPath('out/chart.png', '/apps/helm-v2/ws/Demo'),
      '/apps/helm-v2/ws/Demo/out/chart.png',
    );
    assert.equal(resolveMediaPath('/tmp/x.pdf', '/any'), '/tmp/x.pdf');
  });

  it('builds workspace file API URL', () => {
    const url = workspaceFileApiUrl('gbs-h1/zaza/Xavier', '/apps/ws/plot.png');
    assert.match(url, /conversation=gbs-h1%2Fzaza%2FXavier/);
    assert.match(url, /path=%2Fapps%2Fws%2Fplot.png/);
  });

  it('enriches bare absolute paths into markdown embeds', () => {
    const md = enrichMarkdownMedia('Hello\n/apps/ws/out.png\n/apps/ws/doc.pdf\n/apps/ws/report.docx\n/apps/ws/data.xlsx\n/apps/ws/archive.zip\n');
    assert.match(md, /!\[\]\(\/apps\/ws\/out\.png\)/);
    assert.match(md, /\[📄 \/apps\/ws\/doc\.pdf\]/);
    assert.match(md, /\[📝 \/apps\/ws\/report\.docx\]/);
    assert.match(md, /\[📊 \/apps\/ws\/data\.xlsx\]/);
    assert.match(md, /\[📦 \/apps\/ws\/archive\.zip\]/);
  });

  it('enriches File: agent image paths into inline embeds', () => {
    const md = enrichMarkdownMedia(
      'Done.\n\nFile: /home/zaza/Bureau/NOW3/assets/boat-sunny-water.png\n',
    );
    assert.match(md, /!\[Generated image\]\(\/home\/zaza\/Bureau\/NOW3\/assets\/boat-sunny-water\.png\)/);
    assert.doesNotMatch(md, /^File:/m);
  });

  it('detects rich markdown deliverables', () => {
    assert.equal(looksLikeRichMarkdown('| A | B |\n|---|---|'), true);
    assert.equal(looksLikeRichMarkdown('plain stdout log'), false);
    assert.equal(looksLikeRichMarkdown('![chart](/tmp/x.png)'), true);
  });
});
