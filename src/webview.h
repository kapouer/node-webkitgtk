#ifndef WEBKITGTK_WEBVIEW_H
#define WEBKITGTK_WEBVIEW_H

#include "runnable.h"
#include <node.h>
#include <webkit2/webkit2.h>
#include <nan.h>
#include <gtk/gtkunixprint.h>
#include <map>

using namespace v8;

#define H(name) NanNew<String>(name)

struct RunMapComparator {
  bool operator()(char const *a, char const *b) {
    return strcmp(a, b) < 0;
  }
};

typedef std::map<char*, Runnable*, RunMapComparator> RunMap;
typedef std::pair<char*, Runnable*> RunMapPair;

class WebView : public node::ObjectWrap {
public:
  static const int DOCUMENT_UNLOADED = 0;
  static const int DOCUMENT_LOADING = 1;
  static const int DOCUMENT_LOADED = 2;
  static const int DOCUMENT_ERROR = -1;

  static const GDBusNodeInfo* introspection_data;


  static void Init(Handle<Object>, Handle<Object>);

  static gboolean Authenticate(WebKitWebView*, WebKitAuthenticationRequest*, gpointer);
#ifdef ENABLE_WEB_EXTENSION
  static void InitExtensions(WebKitWebContext*, gpointer);
#endif
  static void ResourceLoad(WebKitWebView*, WebKitWebResource*, WebKitURIRequest*, gpointer);
  static void ResourceResponse(WebKitWebResource*, GParamSpec*, gpointer);
  static void Change(WebKitWebView*, WebKitLoadEvent, gpointer);
  static gboolean Fail(WebKitWebView*, WebKitLoadEvent, gchar*, GError*, gpointer);
  static void TitleChange(WebKitWebView*, GParamSpec*, gpointer);
  static gboolean ScriptDialog(WebKitWebView*, WebKitScriptDialog*, gpointer);
  static void PngFinished(GObject*, GAsyncResult*, gpointer);
  static cairo_status_t PngWrite(void*, const unsigned char*, unsigned int);
  static void RunFinished(GObject*, GAsyncResult*, gpointer);
  static void PrintFinished(WebKitPrintOperation*, gpointer);
  static void PrintFailed(WebKitPrintOperation*, gpointer, gpointer);


  static void handle_method_call(GDBusConnection*, const gchar*, const gchar*,
    const gchar*, const gchar*, GVariant*, GDBusMethodInvocation*, gpointer);
  static void on_bus_acquired(GDBusConnection* connection, const gchar* name, gpointer data);
  static void on_name_acquired(GDBusConnection* connection, const gchar* name, gpointer data);
  static void on_name_lost(GDBusConnection* connection, const gchar* name, gpointer data);

private:
  static v8::Persistent<v8::Function> constructor;
  WebView(Handle<Object>);
  ~WebView();

  RunMap runnables;

  guint dbusId;
  int state;
  int authRetryCount;
  bool allowDialogs;
  char* cookie = NULL;
  char* username = NULL;
  char* password = NULL;
  char* css = NULL;

  char* dbusPath = NULL;

  WebKitWebView* view = NULL;
  GtkWidget* window = NULL;

  NanCallback* pngCallback = NULL;
  NanUtf8String* pngFilename = NULL;

  NanCallback* printCallback = NULL;
  NanUtf8String* printUri = NULL;

  NanCallback* loadCallback = NULL;
  NanCallback* requestCallback = NULL;
  NanCallback* responseCallback = NULL;

  const char* uri = NULL;

  static NAN_METHOD(New);
  static NAN_METHOD(Load);
  static NAN_METHOD(Loop);
  static NAN_METHOD(Run);
  static NAN_METHOD(Png);
  static NAN_METHOD(Print);

  static NAN_GETTER(get_prop);
};

const GDBusNodeInfo* WebView::introspection_data;

#endif
