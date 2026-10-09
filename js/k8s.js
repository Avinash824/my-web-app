/* Kubernetes manifest builder */
const K8s = (() => {
  const $ = (id) => document.getElementById(id);
  const form = () => $("k8sForm");

  const defaultEnv = [
    ["LOG_LEVEL", "info"],
    ["DB_HOST", "orders-db.production.svc.cluster.local"],
  ];

  function q(v) {
    const s = String(v);
    if (s === "" || /^[\d.]+$/.test(s) || /^(true|false|yes|no|null|on|off)$/i.test(s) || /[:#{}\[\],&*?|<>=!%@`'"]/.test(s) || /^\s|\s$/.test(s)) {
      return JSON.stringify(s);
    }
    return s;
  }

  function addEnvRow(k = "", v = "") {
    const row = document.createElement("div");
    row.className = "env-row";
    row.innerHTML = `<input class="mono" placeholder="KEY" value="${k}"><input class="mono" placeholder="value" value="${v}"><button type="button" aria-label="Remove">×</button>`;
    row.querySelector("button").addEventListener("click", () => { row.remove(); render(); });
    row.addEventListener("input", render);
    $("envRows").appendChild(row);
  }

  function read() {
    const f = form();
    const d = Object.fromEntries(new FormData(f).entries());
    ["probes", "hpa", "ingress", "secure"].forEach((k) => (d[k] = f.elements[k].checked));
    d.env = [...$("envRows").querySelectorAll(".env-row")]
      .map((r) => { const [k, v] = r.querySelectorAll("input"); return [k.value.trim(), v.value]; })
      .filter(([k]) => k);
    d.name = (d.name || "app").trim();
    d.namespace = (d.namespace || "default").trim();
    return d;
  }

  function build(d) {
    const L = [];
    const labels = (ind) => [`${ind}app.kubernetes.io/name: ${d.name}`, `${ind}app.kubernetes.io/part-of: ${d.name}`];
    const meta = (kind) => {
      L.push(`apiVersion: ${kind === "Deployment" ? "apps/v1" : kind === "HorizontalPodAutoscaler" ? "autoscaling/v2" : kind === "Ingress" ? "networking.k8s.io/v1" : "v1"}`);
      L.push(`kind: ${kind}`, "metadata:", `  name: ${d.name}`, `  namespace: ${d.namespace}`, "  labels:", ...labels("    "));
    };

    meta("Deployment");
    L.push("spec:");
    if (!d.hpa) L.push(`  replicas: ${d.replicas}`);
    L.push("  revisionHistoryLimit: 5", "  selector:", "    matchLabels:", `      app.kubernetes.io/name: ${d.name}`);
    L.push("  strategy:", "    type: RollingUpdate", "    rollingUpdate:", "      maxSurge: 25%", "      maxUnavailable: 0");
    L.push("  template:", "    metadata:", "      labels:", ...labels("        "), "    spec:");
    if (d.secure) {
      L.push("      securityContext:", "        runAsNonRoot: true", "        runAsUser: 10001", "        fsGroup: 10001", "        seccompProfile:", "          type: RuntimeDefault");
    }
    L.push("      containers:", `        - name: ${d.name}`, `          image: ${q(d.image)}`, "          imagePullPolicy: IfNotPresent");
    L.push("          ports:", "            - name: http", `              containerPort: ${d.port}`, "              protocol: TCP");
    if (d.env.length) {
      L.push("          env:");
      d.env.forEach(([k, v]) => L.push(`            - name: ${k}`, `              value: ${q(v)}`));
    }
    L.push("          resources:", "            requests:", `              cpu: ${q(d.cpuReq)}`, `              memory: ${q(d.memReq)}`, "            limits:", `              cpu: ${q(d.cpuLim)}`, `              memory: ${q(d.memLim)}`);
    if (d.probes) {
      const probe = (name, delay, period) => L.push(`          ${name}:`, "            httpGet:", `              path: ${d.probePath || "/"}`, "              port: http", `            initialDelaySeconds: ${delay}`, `            periodSeconds: ${period}`, "            failureThreshold: 3");
      probe("readinessProbe", 5, 10);
      probe("livenessProbe", 15, 20);
    }
    if (d.secure) {
      L.push("          securityContext:", "            allowPrivilegeEscalation: false", "            readOnlyRootFilesystem: true", "            capabilities:", "              drop: [\"ALL\"]");
      L.push("          volumeMounts:", "            - name: tmp", "              mountPath: /tmp", "      volumes:", "        - name: tmp", "          emptyDir: {}");
    }

    L.push("---");
    meta("Service");
    L.push("spec:", `  type: ${d.svcType}`, "  selector:", `    app.kubernetes.io/name: ${d.name}`, "  ports:", "    - name: http", "      port: 80", "      targetPort: http", "      protocol: TCP");

    if (d.hpa) {
      L.push("---");
      meta("HorizontalPodAutoscaler");
      L.push("spec:", "  scaleTargetRef:", "    apiVersion: apps/v1", "    kind: Deployment", `    name: ${d.name}`, `  minReplicas: ${d.replicas}`, `  maxReplicas: ${Math.max(Number(d.hpaMax), Number(d.replicas))}`);
      L.push("  metrics:", "    - type: Resource", "      resource:", "        name: cpu", "        target:", "          type: Utilization", `          averageUtilization: ${d.hpaCpu}`);
    }

    if (d.ingress) {
      L.push("---");
      meta("Ingress");
      L.push("  annotations:", "    cert-manager.io/cluster-issuer: letsencrypt-prod");
      L.push("spec:", "  ingressClassName: nginx", "  tls:", "    - hosts:", `        - ${d.host}`, `      secretName: ${d.name}-tls`);
      L.push("  rules:", `    - host: ${d.host}`, "      http:", "        paths:", "          - path: /", "            pathType: Prefix", "            backend:", "              service:", `                name: ${d.name}`, "                port:", "                  name: http");
    }
    return L.join("\n") + "\n";
  }

  function parseCpu(v) {
    const m = String(v).trim().match(/^(\d+(?:\.\d+)?)(m?)$/);
    return m ? Number(m[1]) * (m[2] ? 1 : 1000) : NaN;
  }
  function parseMem(v) {
    const m = String(v).trim().match(/^(\d+(?:\.\d+)?)(Ki|Mi|Gi|Ti|K|M|G|T)?$/);
    if (!m) return NaN;
    const mult = { Ki: 2 ** 10, Mi: 2 ** 20, Gi: 2 ** 30, Ti: 2 ** 40, K: 1e3, M: 1e6, G: 1e9, T: 1e12 }[m[2]] || 1;
    return Number(m[1]) * mult;
  }

  function lint(d) {
    const w = [];
    if (!/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(d.name) || d.name.length > 63) w.push("App name must be lowercase alphanumeric or '-', max 63 chars (RFC 1123).");
    const tag = d.image.split("/").pop();
    if (!tag.includes(":") && !d.image.includes("@sha256")) w.push("Image has no tag — Kubernetes will pull :latest. Pin a version or digest.");
    else if (/:latest$/.test(d.image)) w.push("Avoid the :latest tag in production; pin a version for reproducible rollouts.");
    const cr = parseCpu(d.cpuReq), cl = parseCpu(d.cpuLim), mr = parseMem(d.memReq), ml = parseMem(d.memLim);
    if ([cr, cl].some(isNaN)) w.push("CPU values should look like 250m or 0.5.");
    else if (cr > cl) w.push("CPU request is higher than the limit — the pod will be rejected.");
    if ([mr, ml].some(isNaN)) w.push("Memory values should look like 256Mi or 1Gi.");
    else if (mr > ml) w.push("Memory request is higher than the limit — the pod will be rejected.");
    if (Number(d.replicas) < 2 && !d.hpa) w.push("A single replica means downtime during node drains. Consider 2+ replicas.");
    if (!d.probes) w.push("No probes configured — traffic may reach pods before they are ready.");
    d.env.forEach(([k]) => {
      if (/(PASSWORD|SECRET|TOKEN|API_KEY)/i.test(k)) w.push(`"${k}" looks sensitive — move it to a Secret and use valueFrom.secretKeyRef.`);
    });
    if (d.ingress && d.svcType === "LoadBalancer") w.push("Ingress in front of a LoadBalancer Service creates two load balancers. ClusterIP is usually enough.");
    return w;
  }

  function highlight(yaml) {
    const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
    return yaml.split("\n").map((line) => {
      if (line === "---") return '<span class="d">---</span>';
      const m = line.match(/^(\s*(?:- )?)([\w.\/-]+)(:)(\s*)(.*)$/);
      if (!m) return esc(line).replace(/^(\s*- )(.*)$/, '$1<span class="s">$2</span>');
      let val = esc(m[5]);
      if (/^-?\d+(\.\d+)?$|^(true|false)$/.test(m[5])) val = `<span class="n">${val}</span>`;
      else if (val) val = `<span class="s">${val}</span>`;
      return `${esc(m[1])}<span class="k">${m[2]}</span>${m[3]}${m[4]}${val}`;
    }).join("\n");
  }

  let current = "";
  function render() {
    const d = read();
    current = build(d);
    $("yamlOut").innerHTML = highlight(current);
    const warns = lint(d);
    $("k8sLint").innerHTML = warns.length
      ? warns.map((t) => `<li class="warn">⚠ ${t}</li>`).join("")
      : '<li class="ok">✓ No issues found — follows common production practices.</li>';
  }

  function init() {
    defaultEnv.forEach(([k, v]) => addEnvRow(k, v));
    form().addEventListener("input", render);
    form().addEventListener("change", render);
    form().addEventListener("submit", (e) => e.preventDefault());
    $("addEnv").addEventListener("click", () => { addEnvRow(); render(); });
    $("copyYaml").addEventListener("click", () => App.copy(current, "Manifest copied"));
    $("downloadYaml").addEventListener("click", () => {
      const blob = new Blob([current], { type: "text/yaml" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${read().name}.yaml`;
      a.click();
      URL.revokeObjectURL(a.href);
    });
    render();
  }

  return { init, build, lint };
})();
