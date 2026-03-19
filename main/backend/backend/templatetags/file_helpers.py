from django import template

register = template.Library()

FILE_TYPE_ICONS = {
    # Images
    'jpg': '🖼️', 'jpeg': '🖼️', 'png': '🖼️', 'gif': '🖼️', 'webp': '🖼️', 'svg': '🖼️', 'bmp': '🖼️',
    # Documents
    'pdf': '📕', 'doc': '📄', 'docx': '📄', 'txt': '📝', 'rtf': '📄',
    # Spreadsheets
    'xls': '📊', 'xlsx': '📊', 'csv': '📊',
    # Presentations
    'ppt': '📽️', 'pptx': '📽️',
    # Archives
    'zip': '📦', 'rar': '📦', '7z': '📦', 'tar': '📦', 'gz': '📦',
    # Audio
    'mp3': '🎵', 'wav': '🎵', 'ogg': '🎵', 'flac': '🎵',
    # Video
    'mp4': '🎬', 'mkv': '🎬', 'avi': '🎬', 'mov': '🎬', 'webm': '🎬',
    # Code
    'py': '🐍', 'js': '💛', 'html': '🌐', 'css': '🎨', 'java': '☕', 'json': '📋',
    # Executables
    'exe': '⚙️', 'msi': '⚙️',
}


@register.filter(name='file_type_icon')
def file_type_icon(filename):
    """Return an emoji icon based on file extension."""
    if not filename:
        return '📄'
    ext = filename.rsplit('.', 1)[-1].lower() if '.' in filename else ''
    return FILE_TYPE_ICONS.get(ext, '📄')


@register.filter(name='file_extension')
def file_extension(filename):
    """Return the file extension in uppercase."""
    if not filename or '.' not in filename:
        return ''
    return filename.rsplit('.', 1)[-1].upper()
