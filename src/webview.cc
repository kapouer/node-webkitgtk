#include <JavaScriptCore/JSValueRef.h>
#include <JavaScriptCore/JSStringRef.h>
#include "utils.h"
#include "webview.h"
#include "gvariantproxy.h"
#include "webresponse.h"
#include "webauthrequest.h"
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
	this->eventName = getStr(opts, "eventName");
	this->requestCallback = getCb(opts, "requestListener");
	this->receiveDataCallback = getCb(opts, "receiveDataListener");
	this->responseCallback = getCb(opts, "responseListener");
	this->eventsCallback = getCb(opts, "eventsListener");
	this->policyCallback = getCb(opts, "policyListener");
	this->authCallback = getCb(opts, "authListener");
	this->closeCallback = getCb(opts, "closedListener");

	this->offscreen = opts->Get(H("offscreen"))->BooleanValue();
	bool hasInspector = opts->Get(H("inspector"))->BooleanValue();

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
		g_printerr("Error creating server at address %s: %s\n", address, error->message);
		g_error_free(error);
		NanThrowError("WebKitGtk could not create dbus server");
		return;
	}
	g_signal_connect(this->server, "new-connection", G_CALLBACK(on_new_connection), this);

	WebKitWebContext* context = webkit_web_context_get_default();
	const gchar* cacheDir = getStr(opts, "cacheDir");
	if (cacheDir == NULL) {
		cacheDir = g_build_filename(g_get_user_cache_dir(), "node-webkitgtk", NULL);
	}
	webkit_web_context_set_disk_cache_directory(context, cacheDir);
	webkit_web_context_set_process_model(context, WEBKIT_PROCESS_MODEL_MULTIPLE_SECONDARY_PROCESSES);
	webkit_web_context_set_cache_model(context, WEBKIT_CACHE_MODEL_WEB_BROWSER);
	webkit_web_context_set_tls_errors_policy(context, WEBKIT_TLS_ERRORS_POLICY_IGNORE);

	const gchar* wePath = getStr(opts, "webextension");
	if (wePath != NULL) {
		webkit_web_context_set_web_extensions_directory(context, wePath);
		this->contextSignalId = g_signal_connect(context, "initialize-web-extensions", G_CALLBACK(WebView::InitExtensions), this);
	}

	view = WEBKIT_WEB_VIEW(webkit_web_view_new_with_user_content_manager(webkit_user_content_manager_new()));

	if (!this->offscreen) {
		window = gtk_window_new(GTK_WINDOW_TOPLEVEL);
		g_signal_connect(window, "destroy", G_CALLBACK(WebView::WindowClosed), this);
	} else {
		window = gtk_offscreen_window_new();
	}

	GdkScreen* screen = gtk_window_get_screen(GTK_WINDOW(window));
	GdkVisual* rgba_visual = gdk_screen_get_rgba_visual(screen);
	if (rgba_visual) {
		gtk_widget_set_visual(window, rgba_visual);
#if WEBKIT_CHECK_VERSION(2,7,4)
		transparencySupport = TRUE;
#endif
	}
	gtk_widget_set_app_paintable(window, TRUE);

	gtk_container_add(GTK_CONTAINER(window), GTK_WIDGET(view));
	gtk_widget_show_all(window);

	if (hasInspector) {
		g_object_set(G_OBJECT(webkit_web_view_get_settings(view)), "enable-developer-extras", TRUE, NULL);
		inspector = webkit_web_view_get_inspector(view);
		g_signal_connect(inspector, "closed", G_CALLBACK(WebView::InspectorClosed), this);
	} else {
		g_object_set(G_OBJECT(webkit_web_view_get_settings(view)), "enable-developer-extras", FALSE, NULL);
	}

	g_signal_connect(view, "authenticate", G_CALLBACK(WebView::Authenticate), this);
	g_signal_connect(view, "load-failed", G_CALLBACK(WebView::Fail), this);
	g_signal_connect(view, "load-changed", G_CALLBACK(WebView::Change), this);
	g_signal_connect(view, "resource-load-started", G_CALLBACK(WebView::ResourceLoad), this);
	g_signal_connect(view, "script-dialog", G_CALLBACK(WebView::ScriptDialog), this);
	g_signal_connect(view, "decide-policy", G_CALLBACK(WebView::DecidePolicy), this);
}

NAN_METHOD(WebView::Stop) {
	NanScope();
	WebView* self = ObjectWrap::Unwrap<WebView>(args.This());
	bool wasLoading = FALSE;
	if (self->state >= DOCUMENT_LOADING) {
		wasLoading = TRUE;
	}
	self->stopCallback = new NanCallback(args[0].As<Function>());
	webkit_web_view_stop_loading(self->view);
	NanReturnValue(NanNew<Boolean>(wasLoading));
}

NAN_METHOD(WebView::Destroy) {
	NanScope();
	WebView* self = ObjectWrap::Unwrap<WebView>(args.This());
	self->destroy();
	NanReturnUndefined();
}

void WebView::destroy() {
	if (view == NULL) return;
	view = NULL;
	inspector = NULL;
	if (window != NULL) gtk_widget_destroy(window);
	if (content != NULL) delete[] content;

	if (uri != NULL) g_free(uri);

	if (pngCallback != NULL) delete pngCallback;
	if (pngFilename != NULL) delete pngFilename;

	if (printCallback != NULL) delete printCallback;
	if (printUri != NULL) delete printUri;

	if (loadCallback != NULL) delete loadCallback;
	if (stopCallback != NULL) delete stopCallback;
	if (requestCallback != NULL) delete requestCallback;
	if (receiveDataCallback != NULL) delete receiveDataCallback;
	if (responseCallback != NULL) delete responseCallback;
	if (policyCallback != NULL) delete policyCallback;
	if (eventsCallback != NULL) delete eventsCallback;
	if (authCallback != NULL) delete authCallback;
	if (closeCallback != NULL) delete closeCallback;

	g_dbus_server_stop(server);
	g_object_unref(server);
	instances.erase(guid);
	g_free(guid);
}

WebView::~WebView() {
	destroy();
}

void WebView::Init(Handle<Object> exports, Handle<Object> module) {
	node::AtExit(Exit);
	const gchar* introspection_xml =
	"<node>"
	"	<interface name='org.nodejs.WebKitGtk.WebView'>"
	"		<method name='HandleRequest'>"
	"			<arg type='a{sv}' name='dict' direction='in'/>"
	"			<arg type='a{sv}' name='dict' direction='out'/>"
	"		</method>"
	"		<method name='NotifyEvent'>"
	"			<arg type='s' name='message' direction='in'/>"
	"		</method>"
	"	</interface>"
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
	NODE_SET_PROTOTYPE_METHOD(tpl, "stop", WebView::Stop);
	NODE_SET_PROTOTYPE_METHOD(tpl, "destroy", WebView::Destroy);
	NODE_SET_PROTOTYPE_METHOD(tpl, "inspect", WebView::Inspect);

	ATTR(tpl, "uri", get_prop, NULL);

	constructor = Persistent<Function>::New(tpl->GetFunction());
	module->Set(NanNew("exports"), constructor);
	GVariantProxy::Init(exports);
	WebResponse::Init(exports);
	WebAuthRequest::Init(exports);
}

void WebView::InspectorClosed(WebKitWebInspector* inspector, gpointer data) {
	WebView* self = (WebView*)data;
	Handle<Value> argv[] = { NanNew<String>("inspector") };
	self->closeCallback->Call(1, argv);
}

void WebView::WindowClosed(GtkWidget* window, gpointer data) {
	WebView* self = (WebView*)data;
	self->window = NULL;
	Handle<Value> argv[] = { NanNew<String>("window") };
	self->closeCallback->Call(1, argv);
}

gboolean WebView::Authenticate(WebKitWebView* view, WebKitAuthenticationRequest* request, gpointer data) {
	WebView* self = (WebView*)data;
	if (webkit_authentication_request_is_retry(request)) return TRUE;

	// WebKitCredential* savedCred = webkit_authentication_request_get_proposed_credential(request);
	// if (savedCred != NULL) {
		// g_print("saved cred %s\n", webkit_credential_get_username(savedCred));
		// webkit_authentication_request_authenticate(request, savedCred);
		// return TRUE;
	// }

	Handle<Object> obj = NanNew<FunctionTemplate>(WebAuthRequest::constructor)->GetFunction()->NewInstance();
	WebAuthRequest* selfAuthRequest = node::ObjectWrap::Unwrap<WebAuthRequest>(obj);
	selfAuthRequest->init(request);

	Handle<Value> argv[] = { obj };
	Handle<Value> ignore = self->authCallback->Call(1, argv);
	if (ignore->IsBoolean() && ignore->BooleanValue() == true) {
		webkit_authentication_request_authenticate(request, NULL);
	}
	return TRUE;
}

void WebView::InitExtensions(WebKitWebContext* context, gpointer data) {
	WebView* self = (WebView*)data;
	if (self->contextSignalId) {
		g_signal_handler_disconnect(context, self->contextSignalId);
		self->contextSignalId = 0;
	}
	GVariant* userData = g_variant_new("(ss)", g_dbus_server_get_client_address(self->server), self->eventName);
	webkit_web_context_set_web_extensions_initialization_user_data(context, userData);
}

gboolean WebView::DecidePolicy(WebKitWebView* web_view, WebKitPolicyDecision* decision, WebKitPolicyDecisionType type, gpointer data) {
	WebView* self = (WebView*)data;
	if (type == WEBKIT_POLICY_DECISION_TYPE_NAVIGATION_ACTION) {
		WebKitNavigationPolicyDecision* navDecision = WEBKIT_NAVIGATION_POLICY_DECISION(decision);
		WebKitNavigationAction* navAction = webkit_navigation_policy_decision_get_navigation_action(navDecision);
		WebKitURIRequest* navRequest = webkit_navigation_action_get_request(navAction);
		Local<String> uri = NanNew<String>(webkit_uri_request_get_uri(navRequest));
		Local<String> type = NanNew<String>("navigation");
		Handle<Value> argv[] = { type, uri };
		Handle<Value> ignore = self->policyCallback->Call(2, argv);
		if (ignore->IsBoolean() && ignore->BooleanValue() == true) {
			webkit_policy_decision_ignore(decision);
			return TRUE;
		}
	} else if (type == WEBKIT_POLICY_DECISION_TYPE_NEW_WINDOW_ACTION) {
		// ignore for now
		webkit_policy_decision_ignore(decision);
		return TRUE;
		// WebKitNavigationPolicyDecision* navDecision = WEBKIT_NAVIGATION_POLICY_DECISION(decision);
		// WebKitURIRequest* navRequest = webkit_navigation_policy_decision_get_request(navDecision);
		// const gchar* uri = webkit_uri_request_get_uri(navRequest);
		// g_print("policy new window decision for\n%s\n", uri);
	} else if (type == WEBKIT_POLICY_DECISION_TYPE_RESPONSE) {
		// WebKitResponsePolicyDecision* resDecision = WEBKIT_RESPONSE_POLICY_DECISION(decision);
		// WebKitURIRequest* resRequest = webkit_response_policy_decision_get_request(resDecision);
		// const gchar* uri = webkit_uri_request_get_uri(resRequest);
		// g_print("policy response decision for\n%s\n", uri);
	}
	return FALSE;
}

void WebView::ResourceLoad(WebKitWebView* web_view, WebKitWebResource* resource, WebKitURIRequest* request, gpointer data) {
	g_signal_connect(resource, "finished", G_CALLBACK(WebView::ResourceResponse), data);
	g_signal_connect(resource, "received-data", G_CALLBACK(WebView::ResourceReceiveData), data);
}

void WebView::ResourceReceiveData(WebKitWebResource* resource, guint64 length, gpointer data) {
	WebView* self = (WebView*)data;
	const gchar* uri = webkit_web_resource_get_uri(resource);
	int argc = 2;
	Handle<Value> argv[] = { NanNew<String>(uri), NanNew<Integer>((int)length) };
	self->receiveDataCallback->Call(argc, argv);
}

void WebView::ResourceResponse(WebKitWebResource* resource, gpointer data) {
	WebView* self = (WebView*)data;
	WebKitURIResponse* response = webkit_web_resource_get_response(resource);
	Handle<Object> obj = NanNew<FunctionTemplate>(WebResponse::constructor)->GetFunction()->NewInstance();
	WebResponse* selfResponse = node::ObjectWrap::Unwrap<WebResponse>(obj);
	selfResponse->init(resource, response);
	int argc = 1;
	Handle<Value> argv[] = { obj };
	self->responseCallback->Call(argc, argv);
}

gboolean WebView::ScriptDialog(WebKitWebView* web_view, WebKitScriptDialog* dialog, gpointer data) {
	WebView* self = (WebView*)data;
	if (!self->allowDialogs) return TRUE;
	else return FALSE;
}

guint getStatusFromView(WebKitWebView* web_view) {
	WebKitWebResource* resource = webkit_web_view_get_main_resource(web_view);
	if (resource != NULL) {
		WebKitURIResponse* response = webkit_web_resource_get_response(resource);
		if (response != NULL) {
			return webkit_uri_response_get_status_code(response);
		}
	}
	return 0;
}

void WebView::updateUri(const gchar* uri) {
	if (uri != NULL) {
		if (this->uri != NULL) g_free(this->uri);
		this->uri = g_strdup(uri);
	}
}

void WebView::Change(WebKitWebView* web_view, WebKitLoadEvent load_event, gpointer data) {
	WebView* self = (WebView*)data;
	const gchar* uri = webkit_web_view_get_uri(web_view);
//	g_print("change %d %d %s %s\n", load_event, self->state, self->uri, uri);
	switch (load_event) {
		case WEBKIT_LOAD_STARTED: // 0
			/* New load, we have now a provisional URI */
			// provisional_uri = webkit_web_view_get_uri (web_view);
			/* Here we could start a spinner or update the
			* location bar with the provisional URI */
			self->state = DOCUMENT_LOADING;
			self->updateUri(uri);
		break;
		case WEBKIT_LOAD_REDIRECTED: // 1
			// redirected_uri = webkit_web_view_get_uri (web_view);
			if (self->state == DOCUMENT_LOADING) self->updateUri(uri);
		break;
		case WEBKIT_LOAD_COMMITTED: // 2
			/* The load is being performed. Current URI is
			* the final one and it won't change unless a new
			* load is requested or a navigation within the
			* same page is performed */
			if (self->state == DOCUMENT_LOADING) {
				self->state = DOCUMENT_LOADED;
				self->updateUri(uri);
				if (self->loadCallback != NULL) {
					guint status = getStatusFromView(web_view);
					if (status == 0 && self->content != NULL) status = 200;
					Handle<Value> argv[] = {
						NanNull(),
						NanNew<Integer>(status)
					};
					self->loadCallback->Call(2, argv);
					delete self->loadCallback;
					self->loadCallback = NULL;
				}
			}
		break;
		case WEBKIT_LOAD_FINISHED: // 3
			self->state = DOCUMENT_AVAILABLE;
		break;
	}
}

gboolean WebView::Fail(WebKitWebView* web_view, WebKitLoadEvent load_event, gchar* failing_uri, GError* error, gpointer data) {
	WebView* self = (WebView*)data;
//  g_print("fail %d %d %s %s\n", load_event, self->state, self->uri, failing_uri);
	if (self->state >= DOCUMENT_LOADING && g_strcmp0(failing_uri, self->uri) == 0) {
		if (self->loadCallback != NULL) {
			self->state = DOCUMENT_ERROR;
			Handle<Value> argv[] = {
				NanError(error->message),
				NanNew<Integer>(getStatusFromView(web_view))
			};
			self->loadCallback->Call(2, argv);
			delete self->loadCallback;
			self->loadCallback = NULL;
		}
		if (self->stopCallback != NULL) {
			Handle<Value> argvstop[] = {};
			self->stopCallback->Call(0, argvstop);
			delete self->stopCallback;
			self->stopCallback = NULL;
		}
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
	NanCallback* loadCb = new NanCallback(args[2].As<Function>());

	if (self->state == DOCUMENT_LOADING) {
		Handle<Value> argv[] = {
			NanError("A document is already being loaded")
		};
		if (loadCb != NULL) {
			loadCb->Call(1, argv);
			delete loadCb;
		}
		NanReturnUndefined();
	}

	if (!args[0]->IsString()) {
		Handle<Value> argv[] = {
			NanError("load(uri, opts, cb) expected a string for uri argument")
		};
		if (loadCb != NULL) {
			loadCb->Call(1, argv);
			delete loadCb;
		}
		NanReturnUndefined();
	}

	NanUtf8String* uri = new NanUtf8String(args[0]);

	Local<Object> opts = args[1]->ToObject();

	self->script = getStr(opts, "script");
	self->style = getStr(opts, "style");

	if (NanBooleanOptionValue(opts, H("transparent"), false) == TRUE) {
		if (self->transparencySupport == FALSE) {
			g_print("Background cannot be transparent: rgba visual not found and/or webkitgtk >= 2.7.4 required");
		} else {
	#if WEBKIT_CHECK_VERSION(2,7,4)
			static const GdkRGBA transparent = {.0, .0, .0, .0};
			webkit_web_view_set_background_color(self->view, &transparent);
	#endif
		}
	} else {
	#if WEBKIT_CHECK_VERSION(2,7,4)
		static const GdkRGBA opaque = {1.0, 1.0, 1.0, 1.0};
		webkit_web_view_set_background_color(self->view, &opaque);
	#endif
		// nothing to do
	}

	gtk_window_set_decorated(GTK_WINDOW(self->window), NanBooleanOptionValue(opts, H("decorated"), true));

	int w = NanUInt32OptionValue(opts, H("width"), 1024);
	int h = NanUInt32OptionValue(opts, H("height"), 768);
	gtk_window_set_default_size(GTK_WINDOW(self->window), w, h);
	gtk_window_resize(GTK_WINDOW(self->window), w, h);

	const gchar* ua = getStr(opts, "ua");
	if (ua == NULL) {
		ua = "Mozilla/5.0";
	}

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
		"user-agent", ua, NULL
	);

	self->allowDialogs = NanBooleanOptionValue(opts, H("dialogs"), false);

	if (self->loadCallback != NULL) delete self->loadCallback;
	self->loadCallback = loadCb;

	if (self->content != NULL) delete self->content;
	self->content = getStr(opts, "content");

	if (self->state == DOCUMENT_LOADED) webkit_web_view_stop_loading(self->view);

	requestUri(self, **uri);

	NanReturnUndefined();
}

void WebView::requestUri(WebView* self, const char* uri) {
	self->state = DOCUMENT_LOADING;
	self->updateUri(uri);
	gboolean isEmpty = g_strcmp0(uri, "") == 0;

	WebKitUserContentManager* contman = webkit_web_view_get_user_content_manager(self->view);

	webkit_user_content_manager_remove_all_scripts(contman);
	if (self->script != NULL) {
		WebKitUserScript* userScript = webkit_user_script_new(self->script,
			WEBKIT_USER_CONTENT_INJECT_TOP_FRAME,
			WEBKIT_USER_SCRIPT_INJECT_AT_DOCUMENT_START,
			NULL, NULL
		);
		webkit_user_content_manager_add_script(contman, userScript);
		delete self->script;
		self->script = NULL;
	}

	webkit_user_content_manager_remove_all_style_sheets(contman);
	if (self->style != NULL) {
		WebKitUserStyleSheet* styleSheet = webkit_user_style_sheet_new(
			self->style,
			WEBKIT_USER_CONTENT_INJECT_TOP_FRAME,
			WEBKIT_USER_STYLE_LEVEL_USER,
			NULL, NULL
		);
		webkit_user_content_manager_add_style_sheet(contman, styleSheet);
		delete self->style;
		self->style = NULL;
	}

	if (isEmpty || self->content != NULL) {
		if (self->content == NULL) self->content = g_strconcat("", NULL);
		if (isEmpty) {
			g_free(self->uri);
			self->uri = NULL;
		}
		webkit_web_view_load_html(self->view, self->content, self->uri);
	} else {
		webkit_web_view_load_uri(self->view, self->uri);
	}
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
	if (sm->message != NULL) delete sm->message;
	delete sm;
}

NAN_METHOD(WebView::Run) {
	NanScope();
	WebView* self = ObjectWrap::Unwrap<WebView>(args.This());
	if (!args[0]->IsString()) {
		NanThrowError("run(script, ticket) missing script argument");
		NanReturnUndefined();
	}

	NanUtf8String* script = new NanUtf8String(args[0]);
	SelfMessage* data = new SelfMessage(self, args[1]->IsString() ? **(new NanUtf8String(args[1])) : NULL);
	if (self->window != NULL) {
		webkit_web_view_run_javascript(
			self->view,
			**script,
			NULL,
			WebView::RunFinished,
			data
		);
	}
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
		WEBKIT_SNAPSHOT_REGION_FULL_DOCUMENT,
		snapshot_options,
		NULL, //	GCancellable
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
	if (!g_strcmp0(G_OBJECT_TYPE_NAME(gtk_printer_get_backend(printer)), "GtkPrintBackendFile")) {
		*data = strdup(gtk_printer_get_name(printer));
		return TRUE;
	}
	return FALSE;
}

static GtkUnit getUnit(gchar* name) {
	if (g_strcmp0(name, "mm") == 0) {
		return GTK_UNIT_MM;
	} else if (g_strcmp0(name, "in") == 0) {
		return GTK_UNIT_INCH;
	} else {
		return GTK_UNIT_POINTS;
	}
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

	GtkPageSetup* setup = gtk_page_setup_new();

	GtkPaperSize* paperSize;
	Local<Value> paperVal = opts->Get(H("paper"));
	if (paperVal->IsString()) {
		paperSize = gtk_paper_size_new(getStr(opts, "paper"));
	} else if (paperVal->IsObject()) {
		Local<Object> paperObj = paperVal->ToObject();
		paperSize = gtk_paper_size_new_custom(
			"custom",
			"custom",
			NanUInt32OptionValue(paperObj, H("width"), 0),
			NanUInt32OptionValue(paperObj, H("height"), 0),
			getUnit(getStr(paperObj, "unit"))
		);
	} else {
		paperSize = gtk_paper_size_new(gtk_paper_size_get_default());
	}

	gtk_page_setup_set_paper_size_and_default_margins(setup, paperSize);

	Local<Value> marginsVal = opts->Get(H("margins"));
	GtkUnit marginUnit = GTK_UNIT_POINTS;
	gdouble defaultMargin = 0;
	Local<Object> marginsObj;
	if (marginsVal->IsNumber()) {
		defaultMargin = marginsVal->NumberValue();
	} else if (marginsVal->IsObject()) {
		marginsObj = marginsVal->ToObject();
	}
	gtk_page_setup_set_left_margin(setup,
		NanUInt32OptionValue(marginsObj, H("left"), defaultMargin),
		marginUnit);
	gtk_page_setup_set_top_margin(setup,
		NanUInt32OptionValue(marginsObj, H("top"), defaultMargin),
		marginUnit);
	gtk_page_setup_set_right_margin(setup,
		NanUInt32OptionValue(marginsObj, H("right"), defaultMargin),
		marginUnit);
	gtk_page_setup_set_bottom_margin(setup,
		NanUInt32OptionValue(marginsObj, H("bottom"), defaultMargin),
		marginUnit);

	webkit_print_operation_set_page_setup(op, setup);

	// settings
	GtkPrintSettings* settings = gtk_print_settings_new();
	GtkPageOrientation orientation = GTK_PAGE_ORIENTATION_PORTRAIT;

	if (g_strcmp0(getStr(opts, "orientation"), "landscape")) {
		orientation = GTK_PAGE_ORIENTATION_LANDSCAPE;
	}
	gtk_print_settings_set_orientation(settings, orientation);
	gtk_print_settings_set_quality(settings, GTK_PRINT_QUALITY_HIGH);

	char* printer = NULL;
	gtk_enumerate_printers((GtkPrinterFunc)find_file_printer, &printer, NULL, TRUE);
	gtk_print_settings_set_printer(settings, printer);
	delete printer;
	gtk_print_settings_set(settings, GTK_PRINT_SETTINGS_OUTPUT_URI, **self->printUri);

	webkit_print_operation_set_print_settings(op, settings);

	// print
	g_signal_connect(op, "failed", G_CALLBACK(WebView::PrintFailed), self);
	g_signal_connect(op, "finished", G_CALLBACK(WebView::PrintFinished), self);
	webkit_print_operation_print(op);
	g_object_unref(op);
	g_object_unref(settings);
	NanReturnUndefined();
}

NAN_GETTER(WebView::get_prop) {
	NanScope();
	WebView* self = ObjectWrap::Unwrap<WebView>(args.This());
	std::string propstr = TOSTR(property);

	if (propstr == "uri") {
		if (self->uri != NULL) NanReturnValue(NanNew<String>(self->uri));
		else NanReturnUndefined();
	} else {
		NanReturnUndefined();
	}
}

NAN_METHOD(WebView::Loop) {
	NanScope();
	bool block = FALSE;
	int pendings = 0;
	if (args[0]->IsBoolean()) block = args[0]->BooleanValue();
	while (gtk_events_pending()) {
		pendings++;
		gtk_main_iteration_do(block);
		if (!block) break;
	}
	NanReturnValue(NanNew<Integer>(pendings));
}

NAN_METHOD(WebView::Inspect) {
	NanScope();
	WebView* self = ObjectWrap::Unwrap<WebView>(args.This());
	if (self->inspector != NULL) {
		webkit_web_inspector_show(self->inspector);
	}
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
		GVariant* variant = g_variant_get_child_value(parameters, 0);
		GVariantDict dict;
		g_variant_dict_init(&dict, variant);
		Handle<Object> obj = NanNew<FunctionTemplate>(GVariantProxy::constructor)->GetFunction()->NewInstance();
		GVariantProxy* prox = node::ObjectWrap::Unwrap<GVariantProxy>(obj);
		prox->init(variant);
		Handle<Value> argv[] = {
			obj
		};
		self->requestCallback->Call(1, argv);
		GVariant* tuple[1];
		tuple[0] = g_variant_dict_end(prox->dict);
		g_dbus_method_invocation_return_value(invocation, g_variant_new_tuple(tuple, 1));
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
		if (it->second != NULL) it->second->destroy();
	}
	instances.clear();
}


NODE_MODULE(webkitgtk, WebView::Init)
