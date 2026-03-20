from django.conf import settings
from django_hosts import patterns, host

host_patterns = patterns('',
    host(r'www', settings.ROOT_URLCONF, name='www'),
    host(r'cloud', 'backend.urls_cloud', name='cloud'),
    host(r'stoxview', 'backend.urls_stoxview', name='stoxview'),
    host(r'(.*)', settings.ROOT_URLCONF, name='default'),
)
