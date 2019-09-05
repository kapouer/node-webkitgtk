#ifndef WEBKITGTK_WEBVIEW_H
#define WEBKITGTK_WEBVIEW_H

#include <node.h>
#include <webkit2/webkit2.h>
#include <nan.h>
#include <gtk/gtkunixprint.h>
#include <map>

class ViewClosure {
public:
	void* view;
	void* closure;

	ViewClosure(void* v, void* c) {
		view = v;
		closure = c;
	}

	~ViewClosure() {
		view = NULL;
		closure = NULL;
	}
};

class WebView : public node::ObjectWrap {
public:
	static const int DOCUMENT_ERROR = -1;
	static const int DOCUMENT_AVAILABLE = 0;
	static const int DOCUMENT_COMMITED = 1;
	static const int DOCUMENT_LOADING = 2;
	static const int DOCUMENT_LOADED = 3;

	static void Init(v8::Local<v8::Object>, v8::Local<v8::Object>);
	static void Exit(void*);

#if WEBKIT_CHECK_VERSION(2,7,4)
	static const WebKitSnapshotOptions snapshot_options = WEBKIT_SNAPSHOT_OPTIONS_TRANSPARENT_BACKGROUND;
#else
	static const WebKitSnapshotOptions snapshot_options = WEBKIT_SNAPSHOT_OPTIONS_NONE;
#endif

	static void InspectorClosed(WebKitWebInspector*, gpointer);
	static void WindowClosed(GtkWidget*, gpointer);
#if WEBKIT_CHECK_VERSION(2,20,0)
	static void ViewCrashed(WebKitWebView*, WebKitWebProcessTerminationReason, gpointer);
#else
	static void ViewCrashed(WebKitWebView*, gpointer);
#endif
	static gboolean Authenticate(WebKitWebView*, WebKitAuthenticationRequest*, gpointer);
	static void InitExtensions(WebKitWebContext*, gpointer);
	static gboolean DecidePolicy(WebKitWebView*, WebKitPolicyDecision*, WebKitPolicyDecisionType, gpointer);
	static void ResourceLoad(WebKitWebView*, WebKitWebResource*, WebKitURIRequest*, gpointer);
	static void ResourceResponse(WebKitWebResource*, gpointer);
	static void ResourceReceiveData(WebKitWebResource*, guint64, gpointer);
	static void Change(WebKitWebView*, WebKitLoadEvent, gpointer);
	static gboolean Fail(WebKitWebView*, WebKitLoadEvent, gchar*, GError*, gpointer);
	static gboolean ScriptDialog(WebKitWebView*, WebKitScriptDialog*, WebView*);
	static void PngFinished(GObject*, GAsyncResult*, gpointer);
	static cairo_status_t PngWrite(void*, const unsigned char*, unsigned int);
	static void RunFinished(GObject*, GAsyncResult*, gpointer);
	static void RunSyncFinished(GObject*, GAsyncResult*, gpointer);
	static void PrintFinished(WebKitPrintOperation*, gpointer);
	static void PrintFailed(WebKitPrintOperation*, gpointer, gpointer);
	static void GeometryChanged(WebKitWindowProperties*, GParamSpec*, gpointer);

	static void handleEventMessage(WebKitUserContentManager*, WebKitJavascriptResult*, gpointer);

	void destroy();
	void unloaded();
	bool stop(bool, GError* = NULL);

	WebKitUserScript* userScript;
	WebKitUserStyleSheet* userStyleSheet;
private:
	static Nan::Persistent<v8::Function> constructor;
	WebView(v8::Local<v8::Object>);
	~WebView();

	guint contextSignalId;

	gchar* uri = NULL;
	gchar* cacheDir = NULL;
	gchar* extensionsDirectory = NULL;
	void updateUri(const gchar*);
	gulong idGeometryChangedHandler;
	gulong idResourceResponse;
	gulong idEventsHandler;

	int state;
	int authRetryCount;
	bool allowDialogs;
	bool offscreen;
	bool resizing;
	bool transparencySupport;

	bool userContent;
	bool waitFinish;

	WebKitWebContext* context = NULL;
	WebKitWebView* view = NULL;
	GtkWidget* window = NULL;
	WebKitWebInspector* inspector = NULL;

	Nan::Callback* eventsCallback = NULL;
	char* cstamp = NULL;

	Nan::Callback* pngCallback = NULL;
	Nan::Utf8String* pngFilename = NULL;

	Nan::Callback* printCallback = NULL;
	Nan::Utf8String* printUri = NULL;

	Nan::Callback* loadCallback = NULL;
	Nan::Callback* stopCallback = NULL;
	Nan::Callback* receiveDataCallback = NULL;
	Nan::Callback* responseCallback = NULL;
	Nan::Callback* policyCallback = NULL;
	Nan::Callback* authCallback = NULL;
	Nan::Callback* closeCallback = NULL;

	static NAN_METHOD(New);
	static NAN_METHOD(Load);
	static NAN_METHOD(Run);
	static NAN_METHOD(RunSync);
	static NAN_METHOD(Png);
	static NAN_METHOD(Print);
	static NAN_METHOD(ClearCache);
	static NAN_METHOD(Stop);
	static NAN_METHOD(Destroy);
	static NAN_METHOD(Inspect);

	static NAN_GETTER(get_prop);
};

typedef std::map<char*, WebView*> ObjMap;
typedef std::pair<char*, WebView*> ObjMapPair;
static ObjMap instances;

#endif
