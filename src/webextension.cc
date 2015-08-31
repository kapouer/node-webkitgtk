#include <webkit2/webkit-web-extension.h>
#include <JavaScriptCore/JavaScript.h>
#include <string.h>
#include <soup.h>
#include "utils.h"

static WebKitWebExtension* extension;

static guint idLogHandler = 0;
static guint idSendRequestHandler = 0;
static guint idPageCreatedHandler = 0;


static gboolean web_page_send_request(WebKitWebPage* page, WebKitURIRequest* request, WebKitURIResponse* redirected_response, gpointer data) {
	gchar* eventName = (gchar*)data;
	const char* uri = webkit_uri_request_get_uri(request);
	JSValueRef result;
	gboolean hasHandler = FALSE;
	JSGlobalContextRef jsContext = webkit_frame_get_javascript_context_for_script_world(
		webkit_web_page_get_main_frame(page),
		webkit_script_world_get_default()
	);

	const char* funcStr = g_strconcat("window.request_", eventName, NULL);

	JSStringRef funcScript = JSStringCreateWithUTF8CString(g_strconcat("!!", funcStr, NULL));
	result = JSEvaluateScript(
		jsContext,
		funcScript,
		NULL, // JSObjectRef thisObject
		NULL, // JSStringRef sourceURL
		0, // int startingLineNumber
		NULL  // JSValueRef* exception
	);
	if (JSValueIsBoolean(jsContext, result)) {
		hasHandler = JSValueToBoolean(jsContext, result);
	} else {
		g_warning("Error while checking if request function handler exist");
	}

	if (hasHandler == FALSE) {
		g_message("No request handler available to check %s", uri);
		return FALSE;
	}

	const char* scriptStr = g_strconcat(funcStr, "(\"", uri, "\")", NULL);
	JSStringRef script = JSStringCreateWithUTF8CString(scriptStr);

	result = JSEvaluateScript(
		jsContext,
		script,
		NULL, // JSObjectRef thisObject
		NULL, // JSStringRef sourceURL
		0, // int startingLineNumber
		NULL  // JSValueRef* exception
	);

	if (JSValueIsBoolean(jsContext, result)) {
		if (JSValueToBoolean(jsContext, result)) {
			// go through
			g_message("accept %s", uri);
		} else {
			g_message("reject %s", uri);
			webkit_uri_request_set_uri(request, g_strconcat("#", uri, NULL));
		}
	} else if (JSValueIsString(jsContext, result)) {
		JSStringRef js_str_value = JSValueToStringCopy(jsContext, result, NULL);
		gsize str_length = JSStringGetMaximumUTF8CStringSize(js_str_value);
		gchar* str_value = (gchar*)g_malloc(str_length);
		JSStringGetUTF8CString(js_str_value, str_value, str_length);
		JSStringRelease(js_str_value);
		g_message("rewrite %s to %s", uri, str_value);
		webkit_uri_request_set_uri(request, str_value);
		g_free(str_value);
	} else {
		// no return value - meaning ignore the request
		g_message("ignore %s", uri);
		soup_message_headers_replace(
			webkit_uri_request_get_http_headers(request),
			"X-Ignore",
			"1"
		);
	}

	return FALSE;
}


static void web_page_created_callback(WebKitWebExtension* ext, WebKitWebPage* web_page, gpointer data) {
	if (idSendRequestHandler > 0) {
		g_signal_handler_disconnect(web_page, idSendRequestHandler);
		idSendRequestHandler = 0;
	}
	idSendRequestHandler = g_signal_connect(web_page, "send-request", G_CALLBACK(web_page_send_request), data);
}

static void ttyLog(const gchar *log_domain, GLogLevelFlags log_level, const gchar *message, gpointer user_data) {
	FILE* ftty = fopen("/dev/tty", "a");
	if (ftty == NULL) {
		return;
	}
	fprintf(ftty, "%s\n", message);
	fclose(ftty);
}

extern "C" {
	G_MODULE_EXPORT void webkit_web_extension_initialize_with_user_data(WebKitWebExtension* ext, const GVariant* constData) {
		extension = ext;
		idLogHandler = g_log_set_handler(
			NULL,
			G_LOG_LEVEL_WARNING, // production setting
			// G_LOG_LEVEL_MASK, // debug setting
			ttyLog,
			NULL
		);
		gchar* eventName;
		g_variant_get((GVariant*)constData, "(s)", &eventName);
		idPageCreatedHandler = g_signal_connect(extension, "page-created", G_CALLBACK(web_page_created_callback), eventName);
	}
}



static void __attribute__((destructor))
Webkit_Web_extension_shutdown (void) {
	g_log_remove_handler(NULL, idLogHandler);

	if (idPageCreatedHandler > 0) {
		g_signal_handler_disconnect(extension, idPageCreatedHandler);
		idPageCreatedHandler = 0;
	}
	g_object_unref(extension);
	extension = NULL;
}
