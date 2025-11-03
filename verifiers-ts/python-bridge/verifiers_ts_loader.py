"""
Python bridge for loading TypeScript verifiers environments
Enables TypeScript environments to work with vf-eval and vf-tui
"""

import json
import subprocess
import logging
import sys
import tempfile
from pathlib import Path
from typing import Any, Dict, Optional

# Import verifiers types for proper conversion
try:
    from verifiers.types import GenerateOutputs, GenerateMetadata
    from openai.types.chat.chat_completion_message_tool_call import (
        ChatCompletionMessageToolCall,
    )
except ImportError:
    # Fallback if verifiers is not installed
    GenerateOutputs = None
    GenerateMetadata = None
    ChatCompletionMessageToolCall = None

logger = logging.getLogger("verifiers_ts.loader")


# Patch sanitize_tool_calls to handle both dicts and Pydantic models
# This is needed because TypeScript environments return tool calls as dicts,
# but the original function expects Pydantic models
def _patch_sanitize_tool_calls():
    """Patch sanitize_tool_calls to handle both dicts and Pydantic models."""
    try:
        import sys
        from verifiers.utils import message_utils
        from verifiers.utils import eval_utils
        
        # Check if already patched
        if hasattr(message_utils.sanitize_tool_calls, "_verifiers_ts_patched"):
            return
        
        # Save original function
        original_sanitize = message_utils.sanitize_tool_calls
        
        def patched_sanitize_tool_calls(messages):
            """Patched version that handles both Pydantic models and dicts."""
            import json
            if not isinstance(messages, list):
                return messages
            sanitized_messages = []
            for m in messages:
                if "tool_calls" in m:
                    new_m = {
                        "role": m["role"],
                        "content": m.get("content", ""),
                        "tool_calls": [
                            # Handle both Pydantic models and dicts
                            json.dumps(
                                tc.model_dump() if hasattr(tc, "model_dump") else tc
                            )
                            for tc in m.get("tool_calls", [])
                        ],
                    }
                    sanitized_messages.append(new_m)
                else:
                    sanitized_messages.append(m)
            return sanitized_messages
        
        # Mark as patched
        patched_sanitize_tool_calls._verifiers_ts_patched = True
        patched_sanitize_tool_calls._original = original_sanitize
        
        # Apply patch to the module
        message_utils.sanitize_tool_calls = patched_sanitize_tool_calls
        
        # Also patch in eval_utils if it's already imported
        # This is needed because eval_utils imports sanitize_tool_calls directly
        if "verifiers.utils.eval_utils" in sys.modules:
            eval_utils.sanitize_tool_calls = patched_sanitize_tool_calls
        
        logger.debug("Patched sanitize_tool_calls to handle dicts and Pydantic models")
    except ImportError:
        # If verifiers is not available, skip patching
        pass


# Apply patch when module loads
# Use importlib to ensure it happens after verifiers is loaded
try:
    import importlib
    # Try to patch if verifiers is already imported
    _patch_sanitize_tool_calls()
except Exception:
    pass


def load_ts_environment(
    env_id: str,
    env_dir_path: str = "./environments",
    **env_args: Any,
) -> "TSEnvironmentWrapper":
    # Ensure patch is applied when loading an environment
    _patch_sanitize_tool_calls()
    """
    Load a TypeScript environment module.

    Args:
        env_id: Environment identifier (module name)
        env_dir_path: Path to environments directory
        **env_args: Arguments to pass to loadEnvironment function

    Returns:
        TSEnvironmentWrapper instance
    """
    logger.info(f"Loading TypeScript environment: {env_id}")

    # Construct path to TypeScript environment
    env_path = Path(env_dir_path) / env_id

    if not env_path.exists():
        raise ValueError(
            f"Environment directory not found: {env_path}. "
            f"Ensure the TypeScript environment is installed."
        )

    # Find the main entry point
    # Look for package.json or index.ts
    package_json = env_path / "package.json"
    index_ts = env_path / "src" / "index.ts"

    if not package_json.exists() and not index_ts.exists():
        raise ValueError(
            f"Could not find entry point for environment {env_id}. "
            f"Expected package.json or src/index.ts in {env_path}"
        )

    return TSEnvironmentWrapper(env_id, env_path, env_args)


class TSEnvironmentWrapper:
    """
    Wrapper that makes a TypeScript environment compatible with Python verifiers.
    """

    def __init__(
        self,
        env_id: str,
        env_path: Path,
        env_args: Dict[str, Any],
    ):
        self.env_id = env_id
        self.env_path = env_path
        self.env_args = env_args
        self._compiled_path: Optional[Path] = None

    def _ensure_compiled(self) -> Path:
        """Ensure TypeScript is compiled to JavaScript."""
        if self._compiled_path:
            return self._compiled_path

        dist_path = self.env_path / "dist"
        if dist_path.exists():
            self._compiled_path = dist_path
            return dist_path

        # Try to compile
        logger.info(f"Compiling TypeScript environment {self.env_id}")
        # Check for pnpm-lock.yaml or package-lock.json to determine package manager
        import shutil
        pnpm_lock = self.env_path / "pnpm-lock.yaml"
        has_pnpm = shutil.which("pnpm") is not None
        
        build_cmd = ["pnpm", "run", "build"] if (pnpm_lock.exists() or has_pnpm) else ["npm", "run", "build"]
        
        try:
            result = subprocess.run(
                build_cmd,
                cwd=self.env_path,
                check=True,
                capture_output=True,
                text=True,
            )
            # Verify dist/index.js was created
            index_js_path = dist_path / "index.js"
            if not index_js_path.exists():
                raise FileNotFoundError(
                    f"Build completed but index.js not found at {index_js_path}. "
                    f"Build output: {result.stdout}"
                )
            self._compiled_path = dist_path
            return dist_path
        except subprocess.CalledProcessError as e:
            error_msg = e.stderr if e.stderr else e.stdout if e.stdout else str(e)
            logger.error(f"Failed to compile TypeScript: {error_msg}")
            raise RuntimeError(
                f"Failed to compile TypeScript environment {self.env_id}: {error_msg}"
            ) from e

    def _call_ts_method(
        self, method_name: str, *args: Any, **kwargs: Any
    ) -> Any:
        """Call a method on the TypeScript environment via Node.js."""
        dist_path = self._ensure_compiled()
        
        # Get path to index.js
        index_js_path = dist_path / "index.js"
        
        if not index_js_path.exists():
            raise FileNotFoundError(
                f"Compiled index.js not found at {index_js_path}. "
                f"Ensure the environment is built (npm run build)."
            )
        
        # Use absolute path with file:// protocol for ES modules
        # This ensures the import works regardless of where the script runs
        abs_path = index_js_path.resolve()
        
        # Convert to forward slashes and use file:// protocol
        # Node.js requires file:/// (three slashes) for absolute paths on Unix
        # On Windows, it's file:///C:/path format
        import os
        path_str = str(abs_path).replace("\\", "/")
        if os.name == "nt":  # Windows
            # Windows needs file:///C:/path/to/file format
            import_path = f"file:///{path_str}"
        else:
            # Unix-like: file:///absolute/path (three slashes)
            import_path = f"file:///{path_str}"
        
        # Escape the path for JSON in the script
        import_path_json = json.dumps(import_path)

        # Create a temporary Node.js script to call the method
        # Use ES module syntax and handle async loadEnvironment
        # Redirect all console output to stderr so stdout only has JSON
        script = f"""
// Redirect all console output to stderr (JSON must be the only stdout)
const originalWarn = console.warn;
const originalLog = console.log;
const originalInfo = console.info;
const originalError = console.error;

console.warn = (...args) => {{
    process.stderr.write('[WARN] ' + args.map(a => String(a)).join(' ') + '\\n');
}};
console.log = (...args) => {{
    process.stderr.write('[LOG] ' + args.map(a => String(a)).join(' ') + '\\n');
}};
console.info = (...args) => {{
    process.stderr.write('[INFO] ' + args.map(a => String(a)).join(' ') + '\\n');
}};
console.error = (...args) => {{
    process.stderr.write('[ERROR] ' + args.map(a => String(a)).join(' ') + '\\n');
}};

(async () => {{
    try {{
        const module = await import({import_path_json});
        const {{ loadEnvironment }} = module;
        const env = await loadEnvironment({json.dumps(self.env_args)});
        const result = await env.{method_name}(...{json.dumps(args)}, {json.dumps(kwargs)});
        const json = JSON.stringify(result);
        const exitSuccess = () => process.exit(0);
        if (!process.stdout.write(json)) {{
            process.stdout.once('drain', exitSuccess);
        }} else {{
            exitSuccess();
        }}
    }} catch (error) {{
        const errorPayload = JSON.stringify({{
            error: error.message,
            stack: error.stack,
            name: error.name
        }}) + '\\n';
        const exitFailure = () => process.exit(1);
        if (!process.stderr.write(errorPayload)) {{
            process.stderr.once('drain', exitFailure);
        }} else {{
            exitFailure();
        }}
    }}
}})();
"""
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".mjs", delete=False
        ) as f:
            f.write(script)
            script_path = Path(f.name)

        try:
            result = subprocess.run(
                ["node", str(script_path)],
                cwd=self.env_path,
                capture_output=True,
                text=True,
                check=True,
            )
            
            # Log stderr output for debugging (contains console.warn/log/info messages)
            if result.stderr:
                logger.debug(f"TypeScript {method_name} stderr output:\n{result.stderr}")
                # Also print to stdout for visibility during development
                print(result.stderr, file=sys.stderr)
            
            # Check if stdout is empty
            if not result.stdout or not result.stdout.strip():
                error_msg = f"No output from TypeScript method {method_name}"
                if result.stderr:
                    error_msg += f"\nStderr: {result.stderr}"
                logger.error(error_msg)
                raise RuntimeError(error_msg)
            
            # Extract JSON from stdout (may have text before JSON)
            stdout = result.stdout.strip()
            
            # Find the JSON object (starts with {)
            json_start = stdout.find('{')
            if json_start == -1:
                # No JSON found, try to find JSON array
                json_start = stdout.find('[')
                if json_start == -1:
                    error_msg = f"No JSON found in output from {method_name}"
                    error_msg += f"\nStdout: {stdout[:500]}"
                    if result.stderr:
                        error_msg += f"\nStderr: {result.stderr[:500]}"
                    logger.error(error_msg)
                    raise RuntimeError(error_msg)
            
            # Extract JSON portion
            json_str = stdout[json_start:]
            
            # Try to parse the JSON output
            try:
                data = json.loads(json_str)
                
                # Convert dict to GenerateOutputs Pydantic model if this is an evaluate call
                if method_name == "evaluate" and GenerateOutputs is not None:
                    # Convert metadata dict to GenerateMetadata if needed
                    if isinstance(data.get("metadata"), dict):
                        if GenerateMetadata is not None:
                            data["metadata"] = GenerateMetadata(**data["metadata"])
                    
                    # Note: We keep tool calls as dicts because Messages type expects TypedDict,
                    # not Pydantic models. The sanitize_tool_calls function will need to handle
                    # both dicts and Pydantic models (we'll patch it if needed)
                    # For now, ensure tool calls are properly formatted dicts
                    def normalize_tool_calls_in_messages(messages):
                        """Ensure tool_calls are properly formatted as dicts in messages."""
                        if not isinstance(messages, list):
                            return messages
                        normalized = []
                        for msg in messages:
                            if isinstance(msg, dict):
                                new_msg = dict(msg)
                                # Normalize tool_calls if present
                                if "tool_calls" in new_msg and isinstance(
                                    new_msg["tool_calls"], list
                                ):
                                    normalized_tool_calls = []
                                    for tc in new_msg["tool_calls"]:
                                        # If it's a Pydantic model, convert to dict
                                        if hasattr(tc, "model_dump"):
                                            tc_dict = tc.model_dump()
                                        elif isinstance(tc, dict):
                                            tc_dict = dict(tc)
                                        else:
                                            tc_dict = {"function": {"name": str(tc)}}

                                        if "type" not in tc_dict or not isinstance(tc_dict["type"], str):
                                            tc_dict["type"] = "function"

                                        func = tc_dict.get("function") or {}
                                        if not isinstance(func, dict):
                                            func = {"name": str(func)}
                                        if "name" not in func or not isinstance(func["name"], str):
                                            func["name"] = "unknown_tool"
                                        if "arguments" not in func:
                                            func["arguments"] = "{}"
                                        elif not isinstance(func["arguments"], str):
                                            func["arguments"] = json.dumps(func["arguments"])
                                        tc_dict["function"] = func

                                        normalized_tool_calls.append(tc_dict)
                                    new_msg["tool_calls"] = normalized_tool_calls
                                normalized.append(new_msg)
                            else:
                                normalized.append(msg)
                        return normalized
                    
                    # Normalize tool calls in prompt and completion messages
                    if "prompt" in data and isinstance(data["prompt"], list):
                        data["prompt"] = [
                            normalize_tool_calls_in_messages(p) for p in data["prompt"]
                        ]
                    if "completion" in data and isinstance(data["completion"], list):
                        data["completion"] = [
                            normalize_tool_calls_in_messages(c) for c in data["completion"]
                        ]
                    
                    # Convert to GenerateOutputs Pydantic model
                    # Note: sanitize_tool_calls is already patched at module load time
                    return GenerateOutputs(**data)
                
                return data
            except json.JSONDecodeError as json_err:
                error_msg = f"Failed to parse JSON output from {method_name}"
                error_msg += f"\nExtracted JSON: {json_str[:500]}"
                if result.stderr:
                    error_msg += f"\nStderr: {result.stderr[:500]}"
                logger.error(error_msg)
                raise RuntimeError(error_msg) from json_err
                
        except subprocess.CalledProcessError as e:
            error_output = e.stderr or e.stdout or ""
            logger.error(f"TypeScript method call failed: {error_output}")
            # Try to parse error from JSON if available
            try:
                # Look for JSON error in the last line of output
                lines = error_output.strip().split("\n")
                for line in reversed(lines):
                    if line.strip().startswith("{"):
                        error_data = json.loads(line.strip())
                        error_msg = error_data.get("error", "Unknown error")
                        raise RuntimeError(
                            f"Failed to call {method_name} on TypeScript environment: {error_msg}"
                        ) from e
                # If no JSON found, raise with full output
                raise RuntimeError(
                    f"Failed to call {method_name} on TypeScript environment: {error_output}"
                ) from e
            except (json.JSONDecodeError, IndexError, ValueError):
                raise RuntimeError(
                    f"Failed to call {method_name} on TypeScript environment: {error_output}"
                ) from e
        finally:
            script_path.unlink()

    async def evaluate(
        self,
        client: Any,  # AsyncOpenAI
        model: str,
        sampling_args: Optional[Dict[str, Any]] = None,
        num_examples: int = -1,
        rollouts_per_example: int = 1,
        score_rollouts: bool = True,
        max_concurrent: int = -1,
        max_concurrent_generation: Optional[int] = None,
        max_concurrent_scoring: Optional[int] = None,
        interleave_scoring: bool = True,
        results_path: Optional[Any] = None,
        state_columns: Optional[list[str]] = None,
        save_every: int = -1,
        **kwargs: Any,
    ) -> Any:
        """
        Evaluate the environment. This bridges to TypeScript implementation.

        Note: TypeScript environments handle their own model calls via AI SDK,
        so we need to pass API credentials differently.
        """
        # Extract API key from client or environment
        api_key = getattr(client, "api_key", None) or kwargs.get("api_key")
        base_url = getattr(client, "base_url", None) or kwargs.get("base_url")
        
        # Note: TypeScript evaluate() method only accepts these parameters:
        # modelId, samplingArgs, numExamples, rolloutsPerExample, scoreRollouts,
        # maxConcurrent, maxConcurrentGeneration, maxConcurrentScoring, apiKey, baseUrl
        # Parameters like interleave_scoring, results_path, state_columns, save_every
        # are not supported by the TypeScript implementation yet and are ignored here.

        # Run the synchronous subprocess call in a thread pool to not block
        # run_in_executor doesn't accept keyword arguments, so we pass everything positionally
        import asyncio
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(
            None,
            self._call_ts_method,
            "evaluate",
            model,  # modelId
            sampling_args or {},  # samplingArgs
            num_examples,  # numExamples
            rollouts_per_example,  # rolloutsPerExample
            score_rollouts,  # scoreRollouts
            max_concurrent,  # maxConcurrent
            max_concurrent_generation,  # maxConcurrentGeneration
            max_concurrent_scoring,  # maxConcurrentScoring
            api_key,  # apiKey
            str(base_url) if base_url else None,  # baseUrl
        )

    def rollout(
        self,
        client: Any,  # AsyncOpenAI
        model: str,
        prompt: Any,
        completion: Optional[Any] = None,
        answer: str = "",
        state: Optional[Dict[str, Any]] = None,
        task: str = "default",
        info: Optional[Dict[str, Any]] = None,
        example_id: int = 0,
        sampling_args: Optional[Dict[str, Any]] = None,
        **kwargs: Any,
    ) -> tuple:
        """Run a single rollout."""
        api_key = getattr(client, "api_key", None) or kwargs.get("api_key")
        base_url = getattr(client, "base_url", None) or kwargs.get("base_url")

        result = self._call_ts_method(
            "rollout",
            model,
            prompt,
            completion,
            answer,
            state or {},
            task,
            info or {},
            example_id,
            sampling_args or {},
            api_key=api_key,
            base_url=str(base_url) if base_url else None,
            **kwargs,
        )
        return tuple(result)


def load_environment(env_id: str, **env_args: Any) -> TSEnvironmentWrapper:
    """
    Main entry point for loading TypeScript environments.
    This function signature matches the Python verifiers load_environment.
    """
    return load_ts_environment(env_id, **env_args)


