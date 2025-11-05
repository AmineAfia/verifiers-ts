import importlib
import inspect
import logging
import os
import sys
from pathlib import Path
from typing import Callable, Optional

from verifiers.envs.environment import Environment

logger = logging.getLogger("verifiers.utils.env_utils")


def _ensure_ts_bridge_on_path(env_dir_path: Optional[str]) -> None:
    """Ensure the TypeScript bridge module is importable."""
    if "verifiers_ts_loader" in sys.modules:
        return

    bridge_candidates: list[Path] = []

    env_override = os.getenv("VERIFIERS_TS_BRIDGE_PATH")
    if env_override:
        bridge_candidates.append(Path(env_override))

    if env_dir_path:
        bridge_candidates.append(Path(env_dir_path).resolve().parent / "python-bridge")

    for candidate in bridge_candidates:
        if candidate.exists() and candidate.is_dir():
            candidate_str = str(candidate)
            if candidate_str not in sys.path:
                sys.path.insert(0, candidate_str)


def _load_ts_environment(
    env_id: str, env_dir_path: Optional[str], **env_args
) -> Optional[Environment]:
    """Attempt to load a TypeScript environment using the bridge."""
    try:
        _ensure_ts_bridge_on_path(env_dir_path)
        from verifiers_ts_loader import load_ts_environment  # type: ignore
    except Exception:
        return None

    resolved_dir: Optional[Path] = None
    if env_dir_path:
        candidate_root = Path(env_dir_path).resolve()
        if candidate_root.exists():
            resolved_dir = candidate_root
    else:
        env_dir_var = os.getenv("VERIFIERS_ENV_DIR_PATH")
        if env_dir_var:
            candidate_root = Path(env_dir_var).resolve()
            if candidate_root.exists():
                resolved_dir = candidate_root

    search_names = [env_id, env_id.replace("-", "_")]

    if resolved_dir:
        for name in search_names:
            if (resolved_dir / name).exists():
                return load_ts_environment(env_id=env_id, env_dir_path=str(resolved_dir), **env_args)

    # Final attempt: rely on loader defaults if env_dir_path not provided
    if env_dir_path is None and resolved_dir is None:
        return load_ts_environment(env_id=env_id, **env_args)

    return None


def load_environment(
    env_id: str,
    env_dir_path: Optional[str] = None,
    **env_args,
) -> Environment:
    logger.info(f"Loading environment: {env_id}")

    module_name = env_id.replace("-", "_").split("/")[-1]
    try:
        module = importlib.import_module(module_name)

        if not hasattr(module, "load_environment"):
            raise AttributeError(
                f"Module '{module_name}' does not have a 'load_environment' function. "
                f"This usually means there's a package name collision. Please either:\n"
                f"1. Rename your environment (e.g. suffix with '-env')\n"
                f"2. Remove unneeded files with the same name\n"
                f"3. Check that you've installed the correct environment package"
            )

        env_load_func: Callable[..., Environment] = getattr(module, "load_environment")
        sig = inspect.signature(env_load_func)
        defaults_info = []
        for param_name, param in sig.parameters.items():
            if param.default != inspect.Parameter.empty:
                if isinstance(param.default, (dict, list)):
                    defaults_info.append(f"{param_name}={param.default}")
                elif isinstance(param.default, str):
                    defaults_info.append(f"{param_name}='{param.default}'")
                else:
                    defaults_info.append(f"{param_name}={param.default}")
            else:
                defaults_info.append(f"{param_name}=<required>")

        if defaults_info:
            logger.debug(f"Environment defaults: {', '.join(defaults_info)}")

        if env_args:
            provided_params = set(env_args.keys())
        else:
            provided_params = set()

        all_params = set(sig.parameters.keys())
        default_params = all_params - provided_params

        if provided_params:
            provided_values = []
            for param_name in provided_params:
                provided_values.append(f"{param_name}={env_args[param_name]}")
            logger.info(f"Using provided args: {', '.join(provided_values)}")

        if default_params:
            default_values = []
            for param_name in default_params:
                param = sig.parameters[param_name]
                if param.default != inspect.Parameter.empty:
                    if isinstance(param.default, str):
                        default_values.append(f"{param_name}='{param.default}'")
                    else:
                        default_values.append(f"{param_name}={param.default}")
            if default_values:
                logger.info(f"Using default args: {', '.join(default_values)}")

        env_instance: Environment = env_load_func(**env_args)
        env_instance.env_id = env_instance.env_id or env_id
        env_instance.env_args = env_instance.env_args or env_args

        logger.info(f"Successfully loaded environment '{env_id}'")

        return env_instance

    except ImportError as e:
        ts_env = _load_ts_environment(env_id, env_dir_path, **env_args)
        if ts_env is not None:
            ts_env.env_id = ts_env.env_id or env_id
            ts_env.env_args = ts_env.env_args or env_args
            logger.info(f"Loaded TypeScript environment '{env_id}' from {env_dir_path or 'default search path'}")
            return ts_env

        logger.error(
            f"Failed to import environment module {module_name} for env_id {env_id}: {str(e)}"
        )
        raise ValueError(
            f"Could not import '{env_id}' environment. Ensure the package for the '{env_id}' environment is installed."
        ) from e
    except Exception as e:
        logger.error(
            f"Failed to load environment {env_id} with args {env_args}: {str(e)}"
        )
        raise RuntimeError(f"Failed to load environment '{env_id}': {str(e)}") from e
