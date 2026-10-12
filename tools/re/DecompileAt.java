import java.io.PrintWriter;
import java.nio.charset.StandardCharsets;

import ghidra.app.decompiler.DecompInterface;
import ghidra.app.decompiler.DecompileResults;
import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.Function;

/**
 * 在指定地址创建函数（若不存在）并反编译导出 C 伪代码。
 * 用法: -postScript DecompileAt.java <0xADDR> <out.c> [更多成对参数...]
 */
public class DecompileAt extends GhidraScript {
    @Override
    public void run() throws Exception {
        String[] args = getScriptArgs();
        if (args.length < 2 || args.length % 2 != 0) {
            println("usage: DecompileAt.java <0xADDR> <out.c> ...");
            return;
        }
        DecompInterface di = new DecompInterface();
        di.openProgram(currentProgram);
        for (int i = 0; i + 1 < args.length; i += 2) {
            Address addr = currentProgram.getAddressFactory().getAddress(args[i]);
            Function f = getFunctionAt(addr);
            if (f == null) {
                disassemble(addr);
                f = createFunction(addr, "FUN_" + args[i].substring(2).toLowerCase());
                if (f == null) {
                    println("FAILED to create function at " + args[i]);
                    continue;
                }
                println("created function at " + args[i]);
            }
            DecompileResults res = di.decompileFunction(f, 180, monitor);
            String c = res.getDecompiledFunction() != null ? res.getDecompiledFunction().getC() : "// decompile failed: " + res.getErrorMessage();
            StringBuilder callers = new StringBuilder();
            for (Function caller : f.getCallingFunctions(monitor)) {
                callers.append("// caller: ").append(caller.getName()).append(" @ ").append(caller.getEntryPoint()).append("\n");
            }
            PrintWriter out = new PrintWriter(args[i + 1], StandardCharsets.UTF_8);
            out.println("// " + args[i] + "  size=" + f.getBody().getNumAddresses());
            out.print(callers);
            out.println(c);
            out.close();
            println("wrote " + args[i + 1] + " (" + f.getBody().getNumAddresses() + " bytes)");
        }
        di.dispose();
    }
}
