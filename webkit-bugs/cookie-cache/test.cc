#include <gtk/gtk.h>
#include <webkit2/webkit2.h>


bool load1 = FALSE;
bool load2 = FALSE;
const gchar* uri1 = "http://localhost:40001/one";
const gchar* uri2 = "http://localhost:40001/two";
const gchar* setCookie1 = "document.cookie = 'sid=firstcookie; Path=/';";
const gchar* setCookie2 = "document.cookie = 'sid=secondcookie; Path=/';";
const gchar* page1 = "<html><script type='text/javascript'>\
var xhr = new XMLHttpRequest();\
xhr.open('GET', 'http://localhost:40001/xhr', true);\
xhr.send();\
</script></html>";

static void loadblanksetcoookie(const gchar*);

int main(int argc, char *argv[]) {
	gtk_init_check(&argc, &argv);
	loadblanksetcoookie(uri1);
	gtk_main();
}

static void runDone(GObject* object, GAsyncResult* result, void*) {
	GError* err = NULL;
	WebKitWebView* view = WEBKIT_WEB_VIEW(object);
	const gchar* uri = webkit_web_view_get_uri(view);
	WebKitJavascriptResult* js_result = webkit_web_view_run_javascript_finish(view, result, &err);
	if (js_result == NULL) {
		g_printerr("error running script %s\n", err);
		g_error_free(err);
		return;
	}
	webkit_javascript_result_unref(js_result);
	if (g_strcmp0(uri, uri1) == 0) {
		loadblanksetcoookie(uri2);
	} else {
		g_print("load actual page1 content with script that do a xhr GET request to /xhr (need a http server)\n");
		webkit_web_view_load_html(view, page1, uri1);
	}
}


static void change(WebKitWebView* view, WebKitLoadEvent load_event, gpointer data) {
	const gchar* uri = webkit_web_view_get_uri(view);
	g_print("page change %s %d \n", uri, load_event);
	if (load_event != WEBKIT_LOAD_FINISHED) return;
	if (g_strcmp0(uri, uri1) == 0) {
		if (load1 == FALSE) {
			g_print("set cookie by running script on page %s\n%s\n", uri, setCookie1);
			load1 = TRUE;
			webkit_web_view_run_javascript(view, setCookie1, NULL, runDone, NULL);
		} else {
			// DONE page one
		}
	}
	if (g_strcmp0(uri, uri2) == 0) {
		if (load2 == FALSE) {
			g_print("set cookie by running script on page %s\n%s\n", uri, setCookie2);
			load2 = TRUE;
			webkit_web_view_run_javascript(view, setCookie2, NULL, runDone, NULL);
		} else {
			// DONE page two
		}
	}
}

static void loadblanksetcoookie(const gchar* url) {
	g_print("loading new page %s\n", url);
	WebKitWebContext* context = webkit_web_context_get_default();
	webkit_web_context_set_process_model(context, WEBKIT_PROCESS_MODEL_MULTIPLE_SECONDARY_PROCESSES);
	webkit_web_context_set_cache_model(context, WEBKIT_CACHE_MODEL_WEB_BROWSER);
	WebKitWebView* view = WEBKIT_WEB_VIEW(webkit_web_view_new());
	GtkWidget* window = gtk_offscreen_window_new();
	gtk_container_add(GTK_CONTAINER(window), GTK_WIDGET(view));
	gtk_widget_show_all(window);
	g_signal_connect(view, "load-changed", G_CALLBACK(change), NULL);
	WebKitSettings* settings = webkit_web_view_get_settings(view);
	g_object_set(settings,
		"enable-plugins", FALSE,
		"enable-javascript", TRUE,
		"enable-page-cache", FALSE,
		NULL
	);
	webkit_web_view_load_html(view, "<html></html>", url);
}
