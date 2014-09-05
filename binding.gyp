{
  'targets': [
    {
      'target_name': 'webkitgtk',
      'variables': {
        'enable_web_extension%': 'true'
      },
      'conditions': [
        ['enable_web_extension=="true"', {
          'defines': [ 'ENABLE_WEB_EXTENSION' ]
        }],
        ['OS=="linux"', {
          'sources': [ 'src/webresponse.cc', 'src/runnable.cc', 'src/webview.cc' ],
          "include_dirs": ["<!(node -e \"require('nan')\")"],
          'cflags_cc' : [
              '<!@(pkg-config gtk+-3.0 --cflags)',
              '<!@(pkg-config glib-2.0 --cflags)',
              '<!@(pkg-config webkit2gtk-3.0 --cflags)',
              '-I/usr/include/gtk-3.0/unix-print'
          ],
          'libraries':[
              '<!@(pkg-config gtk+-3.0 --libs)',
              '<!@(pkg-config glib-2.0 --libs)',
              '<!@(pkg-config webkit2gtk-3.0 --libs)'
          ],
          'ldflags': ['-ldl']
        }]
      ]
    },
    {
      'target_name': 'webextension',
      'type': 'shared_library',
      'variables': {
        'enable_web_extension%': 'true'
      },
      'conditions': [
        ['enable_web_extension=="true"', {
          'defines': [ 'ENABLE_WEB_EXTENSION' ]
        }],
        ['OS=="linux"', {
          'product_extension': 'so',
          'sources': [ 'src/webextension.cc' ],
          'cflags': ['-fPIC'],
          'cflags_cc' : [
              '<!@(pkg-config glib-2.0 --cflags)',
              '<!@(pkg-config webkit2gtk-3.0 --cflags)',
              '<!@(pkg-config dbus-glib-1 --cflags)'
          ],
          'libraries':[
              '<!@(pkg-config glib-2.0 --libs)',
              '<!@(pkg-config webkit2gtk-3.0 --libs)',
              '<!@(pkg-config dbus-glib-1 --libs)',
              '-ldl'
          ]
        }]
      ]
    },
    {
      'target_name': 'action_after_build',
      'type': 'none',
      'dependencies': [ 'webkitgtk', 'webextension' ],
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
            },
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
                '<@(PRODUCT_DIR)/lib.target/webextension.so'
              ],
              'outputs': [
                'lib/webextension'
              ],
              'action': ['cp', '<@(PRODUCT_DIR)/lib.target/webextension.so', 'lib/ext/']
            }
          ]
        }]
      ]
    }
  ]
}
