import sys
import json
import win32print

def check_print_jobs(printer_name):
    jobs_list = []
    try:
        # Open handle to the printer
        handle = win32print.OpenPrinter(printer_name)
        
        # EnumJobs level 2 gets detailed job info (Document Name, Status, Pages, etc.)
        jobs = win32print.EnumJobs(handle, 0, -1, 2)
        
        for job in jobs:
            jobs_list.append({
                "JobId": job['JobId'],
                "DocumentName": job['pDocument'],
                "Status": job['Status'],
                "TotalPages": job['TotalPages'],
                "PagesPrinted": job['PagesPrinted']
            })
            
        win32print.ClosePrinter(handle)
    except Exception as e:
        pass

    # Print JSON output for Electron to process
    print(json.dumps(jobs_list))

if __name__ == "__main__":
    printer = sys.argv[1] if len(sys.argv) > 1 else win32print.GetDefaultPrinter()
    check_print_jobs(printer)