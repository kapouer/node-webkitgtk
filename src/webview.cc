#include <JavaScriptCore/JSValueRef.h>
#include <JavaScriptCore/JSStringRef.h>
#include "webview.h"
#include "webresponse.h"
#include "dbus.h"

using namespace v8;

Persistent<Function> WebView::constructor;

static const GDBusInterfaceVTable interface_vtable = {
  WebView::handle_method_call,
  NULL,
  NULL,
  NULL
};

WebView::WebView(Handle<Object> opts) {
  if (opts->Has(H("eventName"))) {
    this->eventName = **(new NanUtf8String(opts->Get(H("eventName"))));
  }
  if (opts->Has(H("requestListener"))) {
    this->requestCallback = new NanCallback(opts->Get(H("requestListener")).As<Function>());
  }
  if (opts->Has(H("responseListener"))) {
    this->responseCallback = new NanCallback(opts->Get(H("responseListener")).As<Function>());
  }
  if (opts->Has(H("eventsListener"))) {
    this->eventsCallback = new NanCallback(opts->Get(H("eventsListener")).As<Function>());
  }

  NanAdjustExternalMemory(1000000);
  gtk_init(0, NULL);
  state = 0;

  guid = g_dbus_generate_guid();
  instances.insert(ObjMapPair(guid, this));

  GDBusServerFlags server_flags = G_DBUS_SERVER_FLAGS_NONE;
  GError* error = NULL;
  gchar* address = g_strconcat("unix:tmpdir=", g_get_tmp_dir(), "/node-webkitgtk", NULL);
  this->server = g_dbus_server_new_sync(address, server_flags, guid, NULL, NULL, &error);
  g_dbus_server_start(this->server);

  if (server == NULL) {
    g_printerr ("Error creating server at address %s: %s\n", address, error->message);
    g_error_free(error);
    NanThrowError("WebKitGtk could not create dbus server");
    return;
  }
  g_signal_connect(this->server, "new-connection", G_CALLBACK(on_new_connection), this);

  WebKitWebContext* context = webkit_web_context_get_default();
  webkit_web_context_set_process_model(context, WEBKIT_PROCESS_MODEL_MULTIPLE_SECONDARY_PROCESSES);
  webkit_web_context_set_cache_model(context, WEBKIT_CACHE_MODEL_WEB_BROWSER);

  if (opts->Has(H("webextension"))) {
    NanUtf8String* wePath = new NanUtf8String(opts->Get(H("webextension")));
    if (wePath->Size() > 1) {
      webkit_web_context_set_web_extensions_directory(context, **wePath);
      g_signal_connect(context, "initialize-web-extensions", G_CALLBACK(WebView::InitExtensions), this);
      delete wePath;
    }
  }

  view = WEBKIT_WEB_VIEW(webkit_web_view_new());

  window = gtk_offscreen_window_new();
  gtk_container_add(GTK_CONTAINER(window), GTK_WIDGET(view));
  gtk_widget_show_all(window);

  g_signal_connect(view, "authenticate", G_CALLBACK(WebView::Authenticate), this);
  g_signal_connect(view, "load-failed", G_CALLBACK(WebView::Fail), this);
  g_signal_connect(view, "load-changed", G_CALLBACK(WebView::Change), this);
  g_signal_connect(view, "resource-load-started", G_CALLBACK(WebView::ResourceLoad), this);
  g_signal_connect(view, "script-dialog", G_CALLBACK(WebView::ScriptDialog), this);
}

NAN_METHOD(WebView::Close) {
  NanScope();
  WebView* self = ObjectWrap::Unwrap<WebView>(args.This());
  self->close();
  NanReturnUndefined();
}

void WebView::close() {
  delete[] cookie;
  delete[] username;
  delete[] password;
  delete[] css;

  if (window != NULL) gtk_widget_destroy(window);

  delete pngCallback;
  delete pngFilename;

  delete printCallback;
  delete printUri;

  delete loadCallback;
  delete requestCallback;
  delete responseCallback;
  g_dbus_server_stop(server);
  g_object_unref(server);
  instances.erase(guid);
  g_free(guid);
}

WebView::~WebView() {
  close();
}

void WebView::Init(Handle<Object> exports, Handle<Object> module) {
  node::AtExit(Exit);
  const gchar* introspection_xml =
  "<node>"
  "  <interface name='org.nodejs.WebKitGtk.WebView'>"
  "    <method name='HandleRequest'>"
  "      <arg type='s' name='uri' direction='in'/>"
  "      <arg type='s' name='uri' direction='out'/>"
  "    </method>"
  "    <method name='NotifyEvent'>"
  "      <arg type='s' name='message' direction='in'/>"
  "    </method>"
  "  </interface>"
  "</node>";

  introspection_data = g_dbus_node_info_new_for_xml(introspection_xml, NULL);
  g_assert(introspection_data != NULL);

  Local<FunctionTemplate> tpl = FunctionTemplate::New(WebView::New);
  tpl->SetClassName(NanNew("WebView"));
  tpl->InstanceTemplate()->SetInternalFieldCount(1);

  NODE_SET_PROTOTYPE_METHOD(tpl, "load", WebView::Load);
  NODE_SET_PROTOTYPE_METHOD(tpl, "loop", WebView::Loop);
  NODE_SET_PROTOTYPE_METHOD(tpl, "run", WebView::Run);
  NODE_SET_PROTOTYPE_METHOD(tpl, "png", WebView::Png);
  NODE_SET_PROTOTYPE_METHOD(tpl, "pdf", WebView::Print);
  NODE_SET_PROTOTYPE_METHOD(tpl, "close", WebView::Close);

  ATTR(tpl, "uri", get_prop, NULL);

  constructor = Persistent<Function>::New(tpl->GetFunction());
  module->Set(NanNew("exports"), constructor);

  WebResponse::Init(exports);
}

gboolean WebView::Authenticate(WebKitWebView* view, WebKitAuthenticationRequest* request, gpointer data) {
  WebView* self = (WebView*)data;
  if (!webkit_authentication_request_is_retry(request)) self->authRetryCount = 0;
  else self->authRetryCount += 1;
  if (self->username != NULL && self->password != NULL && self->authRetryCount <= 1) {
    WebKitCredential* creds = webkit_credential_new(self->username, self->password, WEBKIT_CREDENTIAL_PERSISTENCE_FOR_SESSION);
    webkit_authentication_request_authenticate(request, creds);
    webkit_credential_free(creds);
  } else {
    webkit_authentication_request_cancel(request);
  }
  return TRUE;

}

void WebView::InitExtensions(WebKitWebContext* context, gpointer data) {
  WebView* self = (WebView*)data;
  GVariant* userData = g_variant_new("(ss)", g_dbus_server_get_client_address(self->server), self->eventName);
  webkit_web_context_set_web_extensions_initialization_user_data(context, userData);
}

void WebView::ResourceLoad(WebKitWebView* web_view, WebKitWebResource* resource, WebKitURIRequest* request, gpointer data) {
  g_signal_connect(resource, "notify::response", G_CALLBACK(WebView::ResourceResponse), data);
}

void WebView::ResourceResponse(WebKitWebResource* resource, GParamSpec*, gpointer data) {
  WebView* self = (WebView*)data;
  WebKitURIResponse* response = webkit_web_resource_get_response(resource);
  Handle<Object> obj = WebResponse::constructor->GetFunction()->NewInstance();
  WebResponse* selfResponse = node::ObjectWrap::Unwrap<WebResponse>(obj);
  selfResponse->resource = resource;
  g_object_ref(resource);
  selfResponse->response = response;
  g_object_ref(response);
  int argc = 1;
  Handle<Value> argv[] = { obj };
  self->responseCallback->Call(argc, argv);
}

gboolean WebView::ScriptDialog(WebKitWebView* web_view, WebKitScriptDialog* dialog, gpointer data) {
  WebView* self = (WebView*)data;
  if (!self->allowDialogs) return TRUE;
  else return FALSE;
}

void WebView::Change(WebKitWebView* web_view, WebKitLoadEvent load_event, gpointer data) {
  WebView* self = (WebView*)data;
  switch (load_event) {
    case WEBKIT_LOAD_STARTED: // 0
      /* New load, we have now a provisional URI */
      // provisional_uri = webkit_web_view_get_uri (web_view);
      /* Here we could start a spinner or update the
      * location bar with the provisional URI */
      self->uri = webkit_web_view_get_uri(web_view);
    break;
    case WEBKIT_LOAD_REDIRECTED: // 1
      // redirected_uri = webkit_web_view_get_uri (web_view);
      self->uri = webkit_web_view_get_uri(web_view);
    break;
    case WEBKIT_LOAD_COMMITTED: // 2
      /* The load is being performed. Current URI is
      * the final one and it won't change unless a new
      * load is requested or a navigation within the
      * same page is performed */
      self->uri = webkit_web_view_get_uri(web_view);
      if (self->state == DOCUMENT_LOADING) {
        self->state = DOCUMENT_LOADED;
        Handle<Value> argv[] = {};
        self->loadCallback->Call(0, argv);
      }
    break;
    case WEBKIT_LOAD_FINISHED: // 3
      /* Load finished, we can now stop the spinner */

    break;
  }
}

gboolean WebView::Fail(WebKitWebView* web_view, WebKitLoadEvent load_event, gchar* failing_uri, GError* error, gpointer data) {
  WebView* self = (WebView*)data;
  if (load_event <= WEBKIT_LOAD_COMMITTED && self->state == DOCUMENT_LOADING && g_strcmp0(failing_uri, self->uri) == 0) {
    self->state = DOCUMENT_ERROR;
    Handle<Value> argv[] = {
      NanError(error->message)
    };
    self->loadCallback->Call(1, argv);
    return TRUE;
  } else {
    return FALSE;
  }
}

NAN_METHOD(WebView::New) {
  NanScope();
  WebView* self = new WebView(args[0]->ToObject());
  self->Wrap(args.This());
  NanReturnValue(args.This());
}

NAN_METHOD(WebView::Load) {
  NanScope();
  WebView* self = ObjectWrap::Unwrap<WebView>(args.This());

  if (!args[2]->IsFunction()) {
    NanThrowError("load(uri, opts, cb) missing cb argument");
    NanReturnUndefined();
  }

  if (self->state == DOCUMENT_LOADING) {
    Handle<Value> argv[] = {
      NanError("A document is being loaded")
    };
    (new NanCallback(args[2].As<Function>()))->Call(1, argv);
    NanReturnUndefined();
  }
  self->state = DOCUMENT_LOADING;
  if (args[0]->IsString()) self->uri = **(new NanUtf8String(args[0])); // leaking by design :(
  if (self->uri == NULL || strlen(self->uri) == 0) {
    Handle<Value> argv[] = {
      NanError("Empty uri")
    };
    (new NanCallback(args[2].As<Function>()))->Call(1, argv);
    NanReturnUndefined();
  }

  Local<Object> opts = args[1]->ToObject();

  if (self->cookie != NULL) self->cookie = NULL;
  if (opts->Has(H("cookie"))) self->cookie = **(new NanUtf8String(opts->Get(H("cookie"))));

  if (self->username != NULL) delete self->username;
  if (opts->Has(H("username"))) self->username = **(new NanUtf8String(opts->Get(H("username"))));

  if (self->password != NULL) delete self->password;
  if (opts->Has(H("password"))) self->password = **(new NanUtf8String(opts->Get(H("password"))));

  WebKitWebViewGroup* group = webkit_web_view_get_group(self->view);
  webkit_web_view_group_remove_all_user_style_sheets(group);
  if (opts->Has(H("css"))) webkit_web_view_group_add_user_style_sheet(
    group,
    *NanUtf8String(opts->Get(H("css"))),
    self->uri,
    NULL, // whitelist
    NULL, // blacklist
    WEBKIT_INJECTED_CONTENT_FRAMES_TOP_ONLY
  );

  gtk_window_set_default_size(GTK_WINDOW(self->window),
    NanUInt32OptionValue(opts, H("width"), 1024),
    NanUInt32OptionValue(opts, H("height"), 768)
  );
  //gtk_window_resize(GTK_WINDOW(self->window), width, height); // useless

  WebKitSettings* settings = webkit_web_view_get_settings(self->view);
  g_object_set(settings,
    "enable-plugins", FALSE,
		"print-backgrounds", TRUE,
		"enable-javascript", TRUE,
		"enable-html5-database", FALSE,
		"enable-html5-local-storage", FALSE,
		"enable-java", FALSE,
    "enable-page-cache", FALSE,
    "enable-write-console-messages-to-stdout", FALSE,
		"enable-offline-web-application-cache", FALSE,
    "auto-load-images", NanBooleanOptionValue(opts, H("images"), true),
    "zoom-text-only", FALSE,
    "media-playback-requires-user-gesture", FALSE, // effectively disables media playback ?
		"user-agent", "Mozilla/5.0", NULL
  );

  self->allowDialogs = NanBooleanOptionValue(opts, H("dialogs"), false);

  if (self->loadCallback != NULL) delete self->loadCallback;
  self->loadCallback = new NanCallback(args[2].As<Function>());

  WebKitURIRequest* request = webkit_uri_request_new(self->uri);
  webkit_web_view_load_request(self->view, request);
  NanReturnUndefined();
}

void WebView::RunFinished(GObject* object, GAsyncResult* result, gpointer data) {
  GError* error = NULL;
  SelfMessage* sm = (SelfMessage*)data;
  WebKitJavascriptResult* js_result = webkit_web_view_run_javascript_finish(WEBKIT_WEB_VIEW(object), result, &error);
  if (js_result == NULL) { // if NULL, error is defined
    Handle<Value> argv[] = {
      NanError(error->message),
      NanNew(sm->message)
    };
    sm->view->eventsCallback->Call(2, argv);
    g_error_free(error);
  } else {
    webkit_javascript_result_unref(js_result);
  }
  delete sm;
}

NAN_METHOD(WebView::Run) {
  NanScope();
  WebView* self = ObjectWrap::Unwrap<WebView>(args.This());
  if (!args[0]->IsString()) {
    NanThrowError("run(script, message) missing script argument");
    NanReturnUndefined();
  }
  if (!args[1]->IsString()) {
    NanThrowError("run(script, message) missing message argument");
    NanReturnUndefined();
  }

  NanUtf8String* script = new NanUtf8String(args[0]);
  NanUtf8String* message = new NanUtf8String(args[1]);
  SelfMessage* data = new SelfMessage(self, **message);
  webkit_web_view_run_javascript(
    self->view,
    **script,
    NULL,
    WebView::RunFinished,
    data
  );

  delete script;

  NanReturnUndefined();
}

cairo_status_t WebView::PngWrite(void* closure, const unsigned char* data, unsigned int length) {
  WebView* self = (WebView*)closure;
  Handle<Value> argv[] = {
    NanNull(),
    NanNewBufferHandle(reinterpret_cast<const char*>(data), length)
  };
  self->pngCallback->Call(2, argv);
  return CAIRO_STATUS_SUCCESS;
}

void WebView::PngFinished(GObject* object, GAsyncResult* result, gpointer data) {
  WebView* self = (WebView*)data;
  GError* error = NULL;
  cairo_surface_t* surface = webkit_web_view_get_snapshot_finish(self->view, result, &error);
  cairo_status_t status = cairo_surface_write_to_png_stream(surface, WebView::PngWrite, self);
  Handle<Value> argv[] = {};
  if (status == CAIRO_STATUS_SUCCESS) argv[0] = NanNull();
  else argv[0] = NanError(error->message);
  self->pngCallback->Call(1, argv);
  delete self->pngCallback;
  self->pngCallback = NULL;
}

NAN_METHOD(WebView::Png) {
  NanScope();
  WebView* self = ObjectWrap::Unwrap<WebView>(args.This());

  if (!args[0]->IsFunction()) {
    NanThrowError("png(cb) missing cb argument");
    NanReturnUndefined();
  }
  self->pngCallback = new NanCallback(args[0].As<Function>());
  webkit_web_view_get_snapshot(
    self->view,
    WEBKIT_SNAPSHOT_REGION_VISIBLE,
    WEBKIT_SNAPSHOT_OPTIONS_NONE,
    NULL, //  GCancellable
    WebView::PngFinished,
    self
  );
  NanReturnUndefined();
}

void WebView::PrintFinished(WebKitPrintOperation* op, gpointer data) {
  WebView* self = (WebView*)data;
  if (self->printUri == NULL) return;
  Handle<Value> argv[] = {};
  self->printCallback->Call(0, argv);
  delete self->printCallback;
  self->printCallback = NULL;
  delete self->printUri;
  self->printUri = NULL;
}
void WebView::PrintFailed(WebKitPrintOperation* op, gpointer error, gpointer data) {
  WebView* self = (WebView*)data;
  Handle<Value> argv[] = {
    NanError(((GError*)error)->message)
  };
  self->printCallback->Call(1, argv);
  delete self->printCallback;
  self->printCallback = NULL;
  delete self->printUri;
  self->printUri = NULL;
}

static gboolean find_file_printer(GtkPrinter* printer, char** data) {
	if (!g_strcmp0(G_OBJECT_TYPE_NAME(gtk_printer_get_backend(printer)), "GtkPrintBackendFile"))	{
    *data = strdup(gtk_printer_get_name(printer));
		return TRUE;
	}
	return FALSE;
}

NAN_METHOD(WebView::Print) {
  NanScope();
  WebView* self = ObjectWrap::Unwrap<WebView>(args.This());

  if (self->printUri != NULL) {
    NanThrowError("print() can be executed only one at a time");
    NanReturnUndefined();
  }
  if (!args[0]->IsString()) {
    NanThrowError("print(filename, opts, cb) missing filename argument");
    NanReturnUndefined();
  }
  self->printUri = new NanUtf8String(args[0]);
  if (!args[2]->IsFunction()) {
    NanThrowError("print(filename, opts, cb) missing cb argument");
    NanReturnUndefined();
  }
  self->printCallback = new NanCallback(args[2].As<Function>());
  Local<Object> opts = args[1]->ToObject();

  WebKitPrintOperation* op = webkit_print_operation_new(self->view);
  // settings
  GtkPrintSettings* settings = gtk_print_settings_new();
	GtkPaperSize* paper = gtk_paper_size_new(GTK_PAPER_NAME_A4);
  GtkPageOrientation orientation = GTK_PAGE_ORIENTATION_PORTRAIT;

  if (opts->Has(H("orientation")) && g_strcmp0(*String::Utf8Value(opts->Get(H("orientation"))->ToString()), "landscape")) {
    orientation = GTK_PAGE_ORIENTATION_LANDSCAPE;
  }
  gtk_print_settings_set_orientation(settings, orientation);
	gtk_print_settings_set_paper_size(settings, paper);
	gtk_print_settings_set_quality(settings, GTK_PRINT_QUALITY_HIGH);

  char* printer = NULL;
  gtk_enumerate_printers((GtkPrinterFunc)find_file_printer, &printer, NULL, TRUE);
  gtk_print_settings_set_printer(settings, printer);
  delete printer;
  gtk_print_settings_set(settings, GTK_PRINT_SETTINGS_OUTPUT_URI, **self->printUri);

	webkit_print_operation_set_print_settings(op, settings);

  // page setup
  GtkPageSetup* setup = webkit_print_operation_get_page_setup(op);
  if (NanBooleanOptionValue(opts, H("fullpage"), false)) {
    gtk_page_setup_set_right_margin(setup, 0, GTK_UNIT_NONE);
    gtk_page_setup_set_left_margin(setup, 0, GTK_UNIT_NONE);
    gtk_page_setup_set_top_margin(setup, 0, GTK_UNIT_NONE);
    gtk_page_setup_set_bottom_margin(setup, 0, GTK_UNIT_NONE);
	}

  // print
  g_signal_connect(op, "failed", G_CALLBACK(WebView::PrintFailed), self);
  g_signal_connect(op, "finished", G_CALLBACK(WebView::PrintFinished), self);
  webkit_print_operation_print(op);
  NanReturnUndefined();
}

NAN_GETTER(WebView::get_prop) {
  NanScope();
  WebView* self = ObjectWrap::Unwrap<WebView>(args.This());
  std::string propstr = TOSTR(property);

  if (propstr == "uri") {
    NanReturnValue(NanNew<String>(self->uri));
  } else {
    NanReturnUndefined();
  }
}

NAN_METHOD(WebView::Loop) {
  NanScope();
  bool block = FALSE;
  if (args[0]->IsBoolean()) block = args[0]->BooleanValue();
  if (block) while (gtk_events_pending()) gtk_main_iteration_do(TRUE);
  else gtk_main_iteration_do(FALSE);
  NanReturnUndefined();
}

gboolean WebView::on_new_connection(GDBusServer* server, GDBusConnection* connection, gpointer data) {
  g_object_ref(connection);
  GError* error = NULL;
  guint registration_id = g_dbus_connection_register_object(connection, DBUS_OBJECT_WKGTK,
    introspection_data->interfaces[0], &interface_vtable, data, NULL, &error);
  g_assert(registration_id > 0);
  return TRUE;
}

void WebView::handle_method_call(
GDBusConnection* connection,
const gchar* sender,
const gchar* object_path,
const gchar* interface_name,
const gchar* method_name,
GVariant* parameters,
GDBusMethodInvocation* invocation,
gpointer data) {
  WebView* self = (WebView*)data;
  if (g_strcmp0(method_name, "HandleRequest") == 0) {
    const gchar* requestUri;
    g_variant_get(parameters, "(&s)", &requestUri);
    Handle<Value> argv[] = {
      NanNew(requestUri)
    };
    GVariant* response;
    Handle<Value> uriVal = self->requestCallback->Call(1, argv);
    NanUtf8String* uriStr = new NanUtf8String(uriVal->ToString());
    if (uriVal->IsString()) response = g_variant_new("(s)", **uriStr);
    else response = g_variant_new("(s)", "");
    g_dbus_method_invocation_return_value(invocation, response);
    g_free(uriStr);
  } else if (g_strcmp0(method_name, "NotifyEvent") == 0) {
    const gchar* message;
    g_variant_get(parameters, "(&s)", &message);
    Handle<Value> argv[] = {
      NanNull(),
      NanNew(message)
    };
    self->eventsCallback->Call(2, argv);
    g_dbus_method_invocation_return_value(invocation, NULL);
  }
}

void WebView::Exit(void*) {
  NanScope();
  for (ObjMap::iterator it = instances.begin(); it != instances.end(); it++) {
    it->second->close();
  }
  instances.clear();
}


NODE_MODULE(webkitgtk, WebView::Init)
