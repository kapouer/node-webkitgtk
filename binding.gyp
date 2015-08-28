{
  'targets': [
    {
      'target_name': 'webkitgtk',
      'conditions': [
        ['OS=="linux"', {
          'sources': [
            'src/utils.cc',
            'src/gvariantproxy.cc',
            'src/webauthrequest.cc',
            'src/webrequest.cc',
            'src/webresponse.cc',
            'src/webview.cc'
          ],
          'include_dirs': ["<!(node -e \"require('nan')\")"],
          'cflags_cc' : [
              '<!@(pkg-config gtk+-3.0 --cflags)',
              '<!@(pkg-config glib-2.0 --cflags)',
              '<!@(pkg-config webkit2gtk-4.0 --cflags)',
              '-I/usr/include/libsoup-2.4/libsoup',
              '-I/usr/include/gtk-3.0/unix-print'
          ],
          'libraries':[
              '<!@(pkg-config gtk+-3.0 --libs)',
              '<!@(pkg-config glib-2.0 --libs)',
              '<!@(pkg-config webkit2gtk-4.0 --libs)'
          ],
          'ldflags': ['-ldl']
        }]
      ]
    },
    {
      'target_name': 'webextension',
      'type': 'shared_library',
      'conditions': [
        ['OS=="linux"', {
          'product_extension': 'so',
          'sources': [ 'src/utils.cc', 'src/webextension.cc' ],
          'include_dirs': ["<!(node -e \"require('nan')\")"],
          'cflags': ['-fPIC'],
          'cflags_cc' : [
              '<!@(pkg-config glib-2.0 --cflags)',
              '<!@(pkg-config webkit2gtk-4.0 --cflags)',
              '-I/usr/include/libsoup-2.4/libsoup'
          ],
          'libraries':[
              '<!@(pkg-config glib-2.0 --libs)',
              '<!@(pkg-config webkit2gtk-4.0 --libs)',
              '-ldl'
          ]
        }]
      ]
    },
    {
      'target_name': 'mkdirs',
      'type': 'none',
      'dependencies': [ ],
      'conditions': [
        ['OS=="linux"', {
          'actions': [
            {
              'action_name': 'make_dirs',
              'inputs': [],
              'outputs': [
                'lib/ext'
              ],
              'action': ['mkdir', '-p', 'lib/ext']
            }
          ]
        }]
      ]
    },
    {
      'target_name': 'action_after_build',
      'type': 'none',
      'dependencies': [ 'mkdirs', 'webkitgtk', 'webextension' ],
      'conditions': [
        ['OS=="linux"', {
          'actions': [
            {
              'action_name': 'move_node',
              'inputs': [
                '<@(PRODUCT_DIR)/webkitgtk.node'
              ],
              'outputs': [
                'lib/webkitgtk'
              ],
              'action': ['cp', '<@(PRODUCT_DIR)/webkitgtk.node', 'lib/webkitgtk.node']
            },
            {
              'action_name': 'move_ext',
              'inputs': [
                '<@(LIB_DIR)/webextension.so'
              ],
              'outputs': [
                'lib/ext/webextension'
              ],
              'action': ['cp', '<@(LIB_DIR)/webextension.so', 'lib/ext/']
            }
          ]
        }]
      ]
    }
  ]
}
