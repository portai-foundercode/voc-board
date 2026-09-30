// VoC Board 演習用のカスタムlintルール。apps/app/src/** にだけ適用する（.oxlintrc.json）。

const externalUrl = /^\s*(?:https?:)?\/\/\S/i;
const secretName = /(?:api[_-]?key|token|password|secret|database[_-]?url)$/i;
const secretValue = /^[^\s"']{8,}$/;
const directCommunicationModules = /^(?:node:)?(?:https?|http2|net|tls|dgram)$/;

const stringValue = (node) => {
  if (node?.type === "Literal" && typeof node.value === "string") return node.value;
  if (node?.type === "TemplateLiteral" && node.expressions.length === 0) {
    return node.quasis[0].value.cooked;
  }
  return undefined;
};

const nameOf = (node) => {
  if (node?.type === "Identifier") return node.name;
  if (node?.type === "Literal") return String(node.value);
  if (node?.type === "MemberExpression" && !node.computed) return node.property.name;
  return undefined;
};

const noExternalUrl = {
  create(context) {
    const check = (node, value) => {
      if (value !== undefined && externalUrl.test(value)) {
        context.report({
          node,
          message:
            "外部URLは書けません。この演習では外部サービスへ接続しません。/api/... のような同一オリジンのパスを使ってください。",
        });
      }
    };
    return {
      Literal: (node) => check(node, stringValue(node)),
      TemplateLiteral: (node) => check(node, node.quasis[0].value.cooked),
    };
  },
};

const noHardcodedSecret = {
  create(context) {
    const check = (node, name, value) => {
      const text = stringValue(value);
      if (name && text !== undefined && secretName.test(name) && secretValue.test(text)) {
        context.report({
          node,
          message: `秘密情報らしき値を「${name}」へ直接書けません。コード・prompt・commitへ秘密情報を含めないでください。`,
        });
      }
    };
    return {
      VariableDeclarator: (node) => check(node, nameOf(node.id), node.init),
      Property: (node) => check(node, nameOf(node.key), node.value),
      PropertyDefinition: (node) => check(node, nameOf(node.key), node.value),
      AssignmentExpression: (node) => check(node, nameOf(node.left), node.right),
    };
  },
};

const noEnvAccess = {
  create(context) {
    const message =
      "環境変数は使えません。この演習では秘密情報を扱わないので、固定値はコード内の定数にしてください。";
    return {
      MemberExpression(node) {
        const { object, property } = node;
        if (node.computed || property.name !== "env") return;
        const isProcess = object.type === "Identifier" && object.name === "process";
        const isImportMeta = object.type === "MetaProperty" && object.meta.name === "import";
        if (isProcess || isImportMeta) context.report({ node, message });
      },
    };
  },
};

// import / 直接通信のglobalは組込みの no-restricted-imports / no-restricted-globals で検出する。
// ここでは組込みで書けない require() と navigator.sendBeacon だけを検出する。
const noDirectCommunication = {
  create(context) {
    return {
      CallExpression(node) {
        const { callee } = node;
        const isRequire = callee.type === "Identifier" && callee.name === "require";
        const moduleName = isRequire ? stringValue(node.arguments[0]) : undefined;
        if (moduleName !== undefined && directCommunicationModules.test(moduleName)) {
          context.report({
            node,
            message: `「${moduleName}」で直接通信できません。通信はfetchで同一オリジンの /api/... へ送ってください。`,
          });
        }
      },
      MemberExpression(node) {
        if (!node.computed && node.property.name === "sendBeacon") {
          context.report({
            node,
            message:
              "sendBeaconで直接通信できません。通信はfetchで同一オリジンの /api/... へ送ってください。",
          });
        }
      },
    };
  },
};

export default {
  meta: { name: "voc" },
  rules: {
    "no-external-url": noExternalUrl,
    "no-hardcoded-secret": noHardcodedSecret,
    "no-env-access": noEnvAccess,
    "no-direct-communication": noDirectCommunication,
  },
};
