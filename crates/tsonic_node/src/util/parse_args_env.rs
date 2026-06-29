pub fn parse_args(config: ParseArgsConfig) -> ParseArgsResult {
    let mut result = ParseArgsResult::default();
    for (name, descriptor) in &config.options {
        if let Some(default) = &descriptor.default {
            result.values.push((name.clone(), vec![default.clone()]));
        }
    }
    let mut index = 0;
    while index < config.args.len() {
        let arg = &config.args[index];
        if arg == "--" {
            if config.tokens {
                result.tokens.push(ParseArgsToken {
                    kind: "option-terminator".to_string(),
                    index,
                    name: None,
                    raw_name: arg.clone(),
                    value: None,
                    inline_value: false,
                });
            }
            result
                .positionals
                .extend(config.args[index + 1..].iter().cloned());
            break;
        }
        if let Some(rest) = arg.strip_prefix("--") {
            let (name, inline_value) = rest
                .split_once('=')
                .map(|(name, value)| (name, Some(value.to_string())))
                .unwrap_or((rest, None));
            if let Some((_, descriptor)) = config.options.iter().find(|(key, _)| key == name) {
                let value = match descriptor.option_type {
                    ParseArgsOptionType::Boolean => "true".to_string(),
                    ParseArgsOptionType::String => inline_value.unwrap_or_else(|| {
                        index += 1;
                        config.args.get(index).cloned().unwrap_or_default()
                    }),
                };
                if config.tokens {
                    result.tokens.push(ParseArgsToken {
                        kind: "option".to_string(),
                        index,
                        name: Some(name.to_string()),
                        raw_name: format!("--{name}"),
                        value: Some(value.clone()),
                        inline_value: rest.contains('='),
                    });
                }
                set_parsed_arg(&mut result, name, value, descriptor.multiple);
            } else if config.strict {
                result.tokens.push(ParseArgsToken {
                    kind: "unknown-option".to_string(),
                    index,
                    name: Some(name.to_string()),
                    raw_name: arg.clone(),
                    value: None,
                    inline_value: false,
                });
            } else if config.allow_positionals {
                result.positionals.push(arg.clone());
            }
        } else if let Some(shorts) = arg.strip_prefix('-') {
            if !shorts.is_empty()
                && (config.allow_negative || !shorts.chars().all(|ch| ch.is_ascii_digit()))
            {
                for short in shorts.chars() {
                    if let Some((name, descriptor)) = config
                        .options
                        .iter()
                        .find(|(_, descriptor)| descriptor.short == Some(short))
                    {
                        if config.tokens {
                            result.tokens.push(ParseArgsToken {
                                kind: "option".to_string(),
                                index,
                                name: Some(name.clone()),
                                raw_name: format!("-{short}"),
                                value: Some("true".to_string()),
                                inline_value: false,
                            });
                        }
                        set_parsed_arg(&mut result, name, "true".to_string(), descriptor.multiple);
                    }
                }
            } else if config.allow_positionals {
                if config.tokens {
                    result.tokens.push(ParseArgsToken {
                        kind: "positional".to_string(),
                        index,
                        name: None,
                        raw_name: arg.clone(),
                        value: Some(arg.clone()),
                        inline_value: false,
                    });
                }
                result.positionals.push(arg.clone());
            }
        } else if config.allow_positionals {
            if config.tokens {
                result.tokens.push(ParseArgsToken {
                    kind: "positional".to_string(),
                    index,
                    name: None,
                    raw_name: arg.clone(),
                    value: Some(arg.clone()),
                    inline_value: false,
                });
            }
            result.positionals.push(arg.clone());
        }
        index += 1;
    }
    result
}

pub fn parse_args_tokens(config: ParseArgsConfig) -> Vec<ParseArgsToken> {
    parse_args(ParseArgsConfig {
        tokens: true,
        ..config
    })
    .tokens
}

pub fn parse_env(input: &str) -> BTreeMap<String, String> {
    let mut result = BTreeMap::new();
    for line in input.lines() {
        let mut text = line.trim();
        if text.is_empty() || text.starts_with('#') {
            continue;
        }
        if let Some(rest) = text.strip_prefix("export ") {
            text = rest.trim_start();
        }
        let Some((raw_key, raw_value)) = text.split_once('=') else {
            continue;
        };
        let key = raw_key.trim();
        if key.is_empty()
            || !key
                .chars()
                .all(|ch| ch == '_' || ch.is_ascii_alphanumeric())
            || key.chars().next().is_some_and(|ch| ch.is_ascii_digit())
        {
            continue;
        }
        result.insert(key.to_string(), parse_env_value(raw_value));
    }
    result
}

fn parse_env_value(raw_value: &str) -> String {
    let value = raw_value.trim();
    if value.len() >= 2 {
        let bytes = value.as_bytes();
        let first = bytes[0];
        let last = bytes[value.len() - 1];
        if matches!(first, b'\'' | b'"' | b'`') && first == last {
            return unescape_env_quoted_value(&value[1..value.len() - 1], first);
        }
    }
    let mut end = value.len();
    let mut previous_was_space = false;
    for (index, ch) in value.char_indices() {
        if ch == '#' && (index == 0 || previous_was_space) {
            end = index;
            break;
        }
        previous_was_space = ch.is_whitespace();
    }
    value[..end].trim_end().to_string()
}

fn unescape_env_quoted_value(value: &str, quote: u8) -> String {
    if quote == b'\'' {
        return value.to_string();
    }
    let mut output = String::with_capacity(value.len());
    let mut chars = value.chars();
    while let Some(ch) = chars.next() {
        if ch != '\\' {
            output.push(ch);
            continue;
        }
        match chars.next() {
            Some('n') => output.push('\n'),
            Some('r') => output.push('\r'),
            Some('t') => output.push('\t'),
            Some('\\') => output.push('\\'),
            Some('"') if quote == b'"' => output.push('"'),
            Some('`') if quote == b'`' => output.push('`'),
            Some(other) => {
                output.push('\\');
                output.push(other);
            }
            None => output.push('\\'),
        }
    }
    output
}
