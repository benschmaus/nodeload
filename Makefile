.PHONY: clean templates compile
PROCESS_TPL = scripts/process_tpl.js
SOURCES = lib/header.js lib/config.js lib/util.js lib/stats.js lib/user/program.js lib/user/http_program.js lib/loop/loop.js lib/loop/multiloop.js lib/loop/userloop.js lib/loop/multiuserloop.js lib/monitoring/collectors.js lib/monitoring/statslogger.js lib/monitoring/monitor.js lib/monitoring/monitorgroup.js lib/http.js lib/reporting/*.tpl.js lib/reporting/template.js lib/reporting/report.js lib/reporting/reportmanager.js lib/reporting/external.js lib/loadtesting.js  lib/remote/endpoint.js lib/remote/endpointclient.js lib/remote/slave.js lib/remote/slaves.js lib/remote/slavenode.js lib/remote/cluster.js lib/remote/httphandler.js lib/remote/remotetesting.js

all: compile

clean:
	rm -rf ./lib-cov
	rm -f ./lib/reporting/*.tpl.js
	rm -f results-*-err.log results-*-stats.log results-*-summary.html

templates:
	$(PROCESS_TPL) REPORT_SUMMARY_TEMPLATE lib/reporting/summary.tpl > lib/reporting/summary.tpl.js
	$(PROCESS_TPL) DYGRAPH_SOURCE lib/reporting/dygraph.tpl > lib/reporting/dygraph.tpl.js

compile: templates
