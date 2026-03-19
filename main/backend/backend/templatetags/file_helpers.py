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


# Extensions that the in-app editor supports
EDITABLE_EXTENSIONS = {
    'py', 'js', 'ts', 'jsx', 'tsx', 'html', 'htm', 'css', 'scss', 'sass', 'less',
    'java', 'c', 'cpp', 'h', 'hpp', 'cs', 'go', 'rs', 'rb', 'php', 'swift', 'kt',
    'lua', 'r', 'pl', 'sh', 'bash', 'zsh', 'fish', 'bat', 'ps1', 'cmd',
    'sql', 'graphql', 'gql',
    'json', 'xml', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf', 'env',
    'csv', 'tsv',
    'txt', 'md', 'markdown', 'rst', 'log', 'tex', 'bib',
    'svg', 'htaccess', 'nginx',
    'dockerfile', 'dockerignore', 'gitignore', 'editorconfig',
}


@register.filter(name='is_editable')
def is_editable(filename):
    """Check if a file can be opened in the in-app editor."""
    if not filename:
        return False
    if '.' in filename:
        ext = filename.rsplit('.', 1)[-1].lower()
    else:
        ext = filename.lower().lstrip('.')
    return ext in EDITABLE_EXTENSIONS
