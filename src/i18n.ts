export type Lang = 'auto'|'en'|'zh';
let current: 'en'|'zh' = 'en';

/** Resolve 'auto' from Obsidian's own language setting. */
export function setLang(lang: Lang): void {
  if (lang === 'auto') {
    let l = '';
    try { l = (window.localStorage.getItem('language') || navigator.language || '').toLowerCase(); } catch { /* ignore */ }
    current = l.startsWith('zh') ? 'zh' : 'en';
  } else current = lang;
}

const ZH: Record<string, string> = {
  'Crop':'裁切','Aspect':'比例','Color':'矫色','Tone':'色调','Save as':'保存为',
  'On':'开','Off':'关','Off (color only)':'关（仅调色）','Auto':'自动','Soft':'轻','Standard':'标准','Strong':'强','Max':'超强',
  'Full color':'彩色','Grayscale':'灰度','Black & white':'纯黑白',
  'Auto (follow Obsidian)':'自动（跟随 Obsidian）',
  'Auto-detect':'自动检测','Reset corners':'重置角点','Reset':'重置','Auto-detect all':'全部自动检测',
  'Show processed':'显示已处理','Select all':'全选','Cancel':'取消','Close':'关闭',
  'Correct projected slide':'校正投影幻灯片',
  'Batch correct slides in note…':'批量校正本笔记幻灯片…',
  'Correct one photo':'校正单张照片','Correct all photos':'批量校正全部照片',
  'New photo':'新照片','Changed: {0}':'改动：{0}',', ':'、','Frame':'框','Format':'格式',
  'Drag a corner or an edge to align with the slide boundary':'拖动角点或边，使其与幻灯片边界对齐',
  '1 · Drag corners or edges · keys 1–4 cycle a corner':'1 · 拖动角点或边 · 按 1–4 切换角点候选',
  '2 · Corrected preview':'2 · 校正预览',
  'Original photo stays untouched. Only this embed will change.':'原图不会被修改，只替换笔记中的这处引用。',
  'Save & replace in note':'保存并替换',
  'Saving…':'保存中…',
  'Editing from the original photo: {0}':'正在从原图编辑：{0}',
  'Original photo not found — editing the processed image.':'找不到原图 —— 正在编辑已处理的图片。',
  'Image could not be opened: {0}':'无法打开图片：{0}',
  'Could not open slide photo.':'无法打开幻灯片照片。',
  'Please adjust the crop corners: {0}':'请调整裁切角点：{0}',
  'Saved corrected slide: {0}':'已保存校正后的幻灯片：{0}',
  'Could not save corrected slide: {0}':'无法保存校正后的幻灯片：{0}',
  'Save failed. The original image and embed were not overwritten.':'保存失败，原图和笔记引用都没有被改动。',
  'Adjust the four corners to form a valid quadrilateral.':'请调整四个角点，使其构成有效的四边形。',
  'Slide photos in this note':'本笔记中的幻灯片照片',
  'Originals stay untouched. Each selected photo is saved as a new image and its embed is replaced.':'原图不会被修改。每张选中的照片会另存为新图，并替换笔记中的引用。',
  'Save':'保存','Save selected':'保存所选','Save {0} selected':'保存所选 {0} 张',
  '{0}/{1} selected changed':'所选 {1} 张中 {0} 张有改动',
  'Save {0} changed':'保存 {0} 张有改动的',
  'No changes — nothing to save.':'没有改动，无需保存。',
  '{0} unchanged skipped.':'已跳过 {0} 张未改动的。',
  'Loading…':'加载中…',
  'From original: {0}':'来自原图：{0}',
  'Could not open: {0}':'无法打开：{0}',
  'Saved ✓':'已保存 ✓',
  'Failed: {0}':'失败：{0}',
  'Saving {0}/{1}…':'保存中 {0}/{1}…',
  '{0} shown':'显示 {0} 张',
  ' · {0} processed hidden':' · 已隐藏 {0} 张已处理',
  'Number key: next corner candidate · Shift+number: previous candidate':'数字键：切换候选角点；Shift+数字：回到上一个候选',
  '1 · Adjust frame':'1 · 调整框','Photo {0}':'照片 {0}','Image':'图片','Image path':'图片路径','Original path':'原图路径','Copied':'已复制','More':'更多',
  'Saved corrected slide.':'已保存校正后的幻灯片。',
  'All {0} photos in this note are already processed. Tick “Show processed” to re-edit one.':'本笔记中的 {0} 张照片都已处理。勾选“显示已处理”可重新编辑。',
  'Saved {0} corrected slide(s).':'已保存 {0} 张校正后的幻灯片。',
  'Saved {0} corrected slide(s); {1} failed (see the dashboard).':'已保存 {0} 张；{1} 张失败（见面板）。',
  'No local JPG/PNG/WebP/BMP/AVIF images are embedded in this note.':'本笔记中没有本地的 JPG/PNG/WebP/BMP/AVIF 图片。',
  'Failed to read note images: {0}':'读取笔记图片失败：{0}',
  'Aspect ratio':'输出比例','Save as ':'保存格式',
  'Output shape of the corrected slide. These choices are also remembered when you change them in the editor.':'校正后幻灯片的形状。在编辑窗口里修改的选择也会被记住。',
  'File format of the corrected image.':'校正后图片的文件格式。',
  'Correct':'矫正','Strength':'强度','Mode':'模式',
  'Edge trim':'边缘内收','Wide ⚠':'宽 ⚠','Extra wide ⚠⚠':'超宽 ⚠⚠',
  'Pulls the detected frame inward past dark/gold screen bands. Wide reaches thicker bands; Extra wide also trims faint edge lines and keeps a safety margin. Both can cut into the slide and work best on light-background slides.':'自动检测时把框往里收,去掉屏幕的黑边/金边。“宽”能收更厚的边;“超宽”还会收掉淡淡的边线并多留一圈余量。两档都可能切进幻灯片,对浅色底幻灯片比较有效。',
  'Crop to slide':'裁切到幻灯片','Off keeps the whole photo and only applies color/tone.':'关闭后保留整张照片，只应用矫色和色调。',
  'Color correction':'矫色','Auto white balance and levels. Off keeps the original colors; Max also pushes the background to pure white.':'自动白平衡和色阶曲线。关闭则保持原色;“超强”还会把背景推成纯白。',
  'Color, grayscale, or pure black & white (applied after color correction).':'彩色、灰度或纯黑白（在矫色之后应用）。',
  'Language':'语言','Language of this plugin’s interface. Commands update after reloading Obsidian.':'插件界面语言。命令名称需重载 Obsidian 后更新。',
  'Clean originals':'清理原图',
  'Move original photos that already have a corrected version and are no longer used in any note to the trash. You confirm the list first.':'把已有校正版本、且不再被任何笔记使用的原图移到回收站。操作前会先让你确认清单。',
  'Clean…':'清理…',
  'Nothing to clean: no original photo has a corrected version that is unused elsewhere.':'没有可清理的原图。',
  'Clean processed originals?':'清理已处理的原图？',
  '{0} original photo(s) already have a corrected version and are not used in any note. They will be moved to the trash (according to your Obsidian “Deleted files” setting).':'{0} 张原图已有校正版本，且不被任何笔记使用。它们会被移到回收站（遵循 Obsidian 的“已删除文件”设置）。',
  'Move {0} to trash':'将 {0} 张移到回收站',
  'Moved {0} original photo(s) to the trash.':'已将 {0} 张原图移到回收站。',
};

export function t(key: string, ...args: (string|number)[]): string {
  let s = current === 'zh' ? (ZH[key] ?? key) : key;
  args.forEach((a, i) => { s = s.split(`{${i}}`).join(String(a)); });
  return s;
}
