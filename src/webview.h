#ifndef WEBKITGTK_WEBVIEW_H
#define WEBKITGTK_WEBVIEW_H

#include <node.h>
#include <webkit2/webkit2.h>
#include <nan.h>
#include <gtk/gtkunixprint.h>
#include <map>

using namespace v8;

static const GDBusNodeInfo* introspection_data;

class WebView : public node::ObjectWrap {
public:
  static const int DOCUMENT_ERROR = -1;
  static const int DOCUMENT_AVAILABLE = 0;
  static const int DOCUMENT_LOADING = 1;

  static void Init(Handle<Object>, Handle<Object>);
  static void Exit(void*);

  static void InspectorClosed(WebKitWebInspector*, gpointer);
  static void WindowClosed(GtkWidget*, gpointer);
  static gboolean Authenticate(WebKitWebView*, WebKitAuthenticationRequest*, gpointer);
  static void InitExtensions(WebKitWebContext*, gpointer);
  static gboolean DecidePolicy(WebKitWebView*, WebKitPolicyDecision*, WebKitPolicyDecisionType, gpointer);
  static void ResourceLoad(WebKitWebView*, WebKitWebResource*, WebKitURIRequest*, gpointer);
  static void ResourceResponse(WebKitWebResource*, gpointer);
  static void ResourceReceiveData(WebKitWebResource*, guint64, gpointer);
  static void Change(WebKitWebView*, WebKitLoadEvent, gpointer);
  static gboolean Fail(WebKitWebView*, WebKitLoadEvent, gchar*, GError*, gpointer);
  static gboolean ScriptDialog(WebKitWebView*, WebKitScriptDialog*, gpointer);
  static void PngFinished(GObject*, GAsyncResult*, gpointer);
  static cairo_status_t PngWrite(void*, const unsigned char*, unsigned int);
  static void RunFinished(GObject*, GAsyncResult*, gpointer);
  static void PrintFinished(WebKitPrintOperation*, gpointer);
  static void PrintFailed(WebKitPrintOperation*, gpointer, gpointer);

  static void requestUri(WebView*, const char*);
  static void handle_method_call(GDBusConnection*, const gchar*, const gchar*,
    const gchar*, const gchar*, GVariant*, GDBusMethodInvocation*, gpointer);
  static gboolean on_new_connection(GDBusServer*, GDBusConnection*, gpointer);

  void destroy();

private:
  static v8::Persistent<v8::Function> constructor;
  WebView(Handle<Object>);
  ~WebView();

  gchar* guid;
  GDBusServer* server;
  guint contextSignalId;

  int state;
  int authRetryCount;
  bool allowDialogs;
  bool offscreen;

  char* cookie = NULL;
  char* content = NULL;

  WebKitWebView* view = NULL;
  GtkWidget* window = NULL;
  WebKitWebInspector* inspector = NULL;

  NanCallback* eventsCallback = NULL;
  char* eventName = NULL;

  NanCallback* pngCallback = NULL;
  NanUtf8String* pngFilename = NULL;

  NanCallback* printCallback = NULL;
  NanUtf8String* printUri = NULL;

  NanCallback* loadCallback = NULL;
  NanCallback* stopCallback = NULL;
  NanCallback* requestCallback = NULL;
  NanCallback* receiveDataCallback = NULL;
  NanCallback* responseCallback = NULL;
  NanCallback* policyCallback = NULL;
  NanCallback* authCallback = NULL;
  NanCallback* closeCallback = NULL;

  const char* uri = NULL;
  const char* nextUri = NULL;

  static NAN_METHOD(New);
  static NAN_METHOD(Load);
  static NAN_METHOD(Loop);
  static NAN_METHOD(Run);
  static NAN_METHOD(Png);
  static NAN_METHOD(Print);
  static NAN_METHOD(Stop);
  static NAN_METHOD(Destroy);

  static NAN_GETTER(get_prop);
};

struct SelfMessage {
  WebView* view;
  char* message;
  SelfMessage(WebView* w, char* m) {
    view = w;
    message = m;
  };
};
typedef std::map<char*, WebView*> ObjMap;
typedef std::pair<char*, WebView*> ObjMapPair;
static ObjMap instances;

#endif
